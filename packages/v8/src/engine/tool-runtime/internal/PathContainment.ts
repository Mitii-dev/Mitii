import * as path from "node:path";

import type { WorkspaceFileSystemPort } from "../contracts";
import type { ToolReasonCode } from "../contracts";

export class PathContainmentError extends Error {
  public readonly reasonCode: ToolReasonCode;

  constructor(reasonCode: ToolReasonCode, message: string) {
    super(message);
    this.name = "PathContainmentError";
    this.reasonCode = reasonCode;
  }
}

/**
 * Normalizes a repository-relative path for grant/scope checks.
 */
export function normalizeRelativePath(targetPath: string): string {
  assertNoNullBytes(targetPath);

  // Chat @-mentions (@packages, @apps/docs) should resolve as workspace paths.
  const withoutAtMention = targetPath.replace(/^@(?=[A-Za-z0-9_.-])/, "");
  const slashNormalized = withoutAtMention.replace(/\\/g, "/");
  if (isAbsolutePath(slashNormalized)) {
    throw new PathContainmentError(
      "path_escape",
      `Expected a relative path, received absolute: "${targetPath}".`,
    );
  }

  const normalized = path.posix.normalize(slashNormalized);
  const trimmed = normalized.replace(/^\/+/, "").replace(/\/+$/, "");

  if (trimmed === ".." || trimmed.startsWith("../")) {
    throw new PathContainmentError(
      "path_escape",
      `Path escapes the workspace: "${targetPath}".`,
    );
  }

  if (trimmed === "." || trimmed === "") {
    return ".";
  }

  return trimmed;
}

export function isPathWithinScopes(
  relativePath: string,
  pathScopes: readonly string[],
): boolean {
  const normalizedTarget = normalizeRelativePath(relativePath);
  for (const scope of pathScopes) {
    const normalizedScope = normalizeRelativePath(scope);
    if (normalizedScope === ".") {
      return true;
    }
    if (
      normalizedTarget === normalizedScope ||
      normalizedTarget.startsWith(`${normalizedScope}/`)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * When a search/glob defaults to workspace root but the grant is folder-scoped,
 * remap "." to the pattern prefix or the first concrete path scope.
 */
export function resolveScopedSearchPath(params: {
  requestedPath: string;
  pattern?: string;
  pathScopes: readonly string[];
}): string {
  const requested = normalizeRelativePath(params.requestedPath);
  if (isPathWithinScopes(requested, params.pathScopes)) {
    return requested;
  }
  if (requested !== ".") {
    return requested;
  }

  const fromPattern = params.pattern
    ? globPatternDirectory(params.pattern)
    : undefined;
  if (fromPattern && isPathWithinScopes(fromPattern, params.pathScopes)) {
    return fromPattern;
  }

  const scoped = params.pathScopes
    .map((scope) => normalizeRelativePath(scope))
    .find((scope) => scope !== ".");
  return scoped ?? requested;
}

function globPatternDirectory(pattern: string): string | undefined {
  const cut = pattern.search(/[*?[]/);
  const prefix = (cut === -1 ? pattern : pattern.slice(0, cut)).replace(
    /\\/g,
    "/",
  );
  const trimmed = prefix.replace(/\/+$/, "");
  if (!trimmed || trimmed === ".") {
    return undefined;
  }
  const lastSlash = trimmed.lastIndexOf("/");
  if (lastSlash <= 0) {
    return undefined;
  }
  return trimmed.slice(0, lastSlash);
}

export function isPhysicalPathWithinRoot(
  workspaceRoot: string,
  absolutePath: string,
): boolean {
  if (workspaceRoot.includes("\0") || absolutePath.includes("\0")) {
    return false;
  }
  const absoluteRoot = path.resolve(workspaceRoot);
  const absoluteTarget = path.resolve(absolutePath);
  const relative = path.relative(absoluteRoot, absoluteTarget);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${path.sep}`) &&
      !path.isAbsolute(relative))
  );
}

export interface ContainedPath {
  relativePath: string;
  absolutePath: string;
  realPath: string;
}

/**
 * Canonical workspace root for containment checks against realpath'd targets.
 * Logical roots like macOS `/var/folders/...` resolve to `/private/var/folders/...`;
 * comparing without this step falsely rejects in-workspace paths as symlink escapes.
 */
async function resolvePhysicalWorkspaceRoot(params: {
  fileSystem: WorkspaceFileSystemPort;
  workspaceRoot: string;
}): Promise<string> {
  const absoluteRoot = path.resolve(params.workspaceRoot);
  try {
    return await params.fileSystem.realpath(absoluteRoot);
  } catch {
    return absoluteRoot;
  }
}

/**
 * Resolves a relative path, enforces grant scopes, and rejects symlink escapes.
 */
export async function resolveContainedPath(params: {
  fileSystem: WorkspaceFileSystemPort;
  workspaceRoot: string;
  requestedPath: string;
  pathScopes: readonly string[];
  mustExist?: boolean;
}): Promise<ContainedPath> {
  const relativePath = normalizeRelativePath(params.requestedPath);

  if (!isPathWithinScopes(relativePath, params.pathScopes)) {
    throw new PathContainmentError(
      "path_out_of_scope",
      `Path "${relativePath}" is outside granted pathScopes.`,
    );
  }

  const absoluteRoot = path.resolve(params.workspaceRoot);
  const physicalRoot = await resolvePhysicalWorkspaceRoot({
    fileSystem: params.fileSystem,
    workspaceRoot: absoluteRoot,
  });
  const absolutePath =
    relativePath === "."
      ? absoluteRoot
      : params.fileSystem.resolve(absoluteRoot, relativePath);

  if (!isPhysicalPathWithinRoot(absoluteRoot, absolutePath)) {
    throw new PathContainmentError(
      "path_escape",
      `Resolved path escapes workspace: "${params.requestedPath}".`,
    );
  }

  let realPath: string;
  try {
    realPath = await params.fileSystem.realpath(absolutePath);
  } catch {
    if (params.mustExist === false) {
      await assertCreatablePathWithinRoot({
        fileSystem: params.fileSystem,
        absoluteRoot,
        physicalRoot,
        absolutePath,
        requestedPath: params.requestedPath,
      });
      return { relativePath, absolutePath, realPath: absolutePath };
    }
    throw new PathContainmentError(
      "execution_failed",
      `Path does not exist or cannot be resolved: "${params.requestedPath}".`,
    );
  }

  if (!isPhysicalPathWithinRoot(physicalRoot, realPath)) {
    throw new PathContainmentError(
      "symlink_escape",
      `Symlink target escapes workspace for "${params.requestedPath}".`,
    );
  }

  // Also reject when any symlink component in the path leaves the root.
  try {
    const stat = await params.fileSystem.lstat(absolutePath);
    if (stat.isSymlink) {
      const linkReal = await params.fileSystem.realpath(absolutePath);
      if (!isPhysicalPathWithinRoot(physicalRoot, linkReal)) {
        throw new PathContainmentError(
          "symlink_escape",
          `Symlink escapes workspace: "${params.requestedPath}".`,
        );
      }
    }
  } catch (error) {
    if (error instanceof PathContainmentError) {
      throw error;
    }
    // lstat failure after successful realpath is unexpected; treat as failure.
    throw new PathContainmentError(
      "execution_failed",
      `Unable to inspect path: "${params.requestedPath}".`,
    );
  }

  return { relativePath, absolutePath, realPath };
}

/**
 * For create paths: walk up to an existing ancestor and ensure the logical
 * target stays inside the workspace (no symlink escape via parents).
 */
async function assertCreatablePathWithinRoot(params: {
  fileSystem: WorkspaceFileSystemPort;
  absoluteRoot: string;
  physicalRoot: string;
  absolutePath: string;
  requestedPath: string;
}): Promise<void> {
  let cursor = path.dirname(params.absolutePath);
  for (let depth = 0; depth < 64; depth += 1) {
    if (!isPhysicalPathWithinRoot(params.absoluteRoot, cursor)) {
      throw new PathContainmentError(
        "path_escape",
        `Create path escapes workspace: "${params.requestedPath}".`,
      );
    }
    try {
      const realAncestor = await params.fileSystem.realpath(cursor);
      if (!isPhysicalPathWithinRoot(params.physicalRoot, realAncestor)) {
        throw new PathContainmentError(
          "symlink_escape",
          `Create path parent escapes workspace: "${params.requestedPath}".`,
        );
      }
      return;
    } catch (error) {
      if (error instanceof PathContainmentError) {
        throw error;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        break;
      }
      cursor = parent;
    }
  }
  throw new PathContainmentError(
    "path_escape",
    `Unable to resolve create path: "${params.requestedPath}".`,
  );
}

function assertNoNullBytes(targetPath: string): void {
  if (targetPath.includes("\0")) {
    throw new PathContainmentError(
      "path_escape",
      `Path contains null bytes: "${targetPath}".`,
    );
  }
}

function isAbsolutePath(slashNormalizedPath: string): boolean {
  return (
    path.posix.isAbsolute(slashNormalizedPath) ||
    /^[a-zA-Z]:\//.test(slashNormalizedPath)
  );
}
