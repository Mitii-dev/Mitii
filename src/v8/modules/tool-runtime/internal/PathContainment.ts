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

  const slashNormalized = targetPath.replace(/\\/g, "/");
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
  } catch (error) {
    if (params.mustExist === false) {
      // For create paths we would allow missing; Phase 4 is read-only.
      throw new PathContainmentError(
        "path_escape",
        `Unable to resolve path: "${params.requestedPath}".`,
      );
    }
    throw new PathContainmentError(
      "execution_failed",
      `Path does not exist or cannot be resolved: "${params.requestedPath}".`,
    );
  }

  if (!isPhysicalPathWithinRoot(absoluteRoot, realPath)) {
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
      if (!isPhysicalPathWithinRoot(absoluteRoot, linkReal)) {
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
