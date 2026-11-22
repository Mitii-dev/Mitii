import * as path from "node:path";

import type { WorkspaceFileEntry, WorkspaceSnapshot } from "../workspace";

import type {
  DetectedProjectRoot,
  ProjectCatalogWarning,
  ProjectDefinition,
  ProjectManifestInfo,
} from "./types";

export function mergeScripts(
  manifestInfos: readonly ProjectManifestInfo[],
): Record<string, string> {
  const scripts: Record<string, string> = {};

  for (const info of manifestInfos) {
    const entries = Object.entries(info.scripts).sort(([left], [right]) =>
      left.localeCompare(right),
    );

    for (const [name, command] of entries) {
      if (scripts[name] === undefined) {
        scripts[name] = command;
        continue;
      }

      if (scripts[name] === command) {
        continue;
      }

      /*
       * Preserve both factual script definitions when different
       * ecosystems expose the same script name.
       */
      const qualifiedName = `${info.ecosystem}:${name}`;

      scripts[qualifiedName] = command;
    }
  }

  return Object.fromEntries(
    Object.entries(scripts).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  );
}


export function createFallbackProjectName(
  projectRoot: DetectedProjectRoot,
  snapshot: WorkspaceSnapshot,
): string {
  if (projectRoot.relativeRoot) {
    const basename = path.posix.basename(projectRoot.relativeRoot);

    if (basename) {
      return basename;
    }
  }

  const workspaceRoot = snapshot.roots.find(
    (root) => root.id === projectRoot.rootId,
  );

  return workspaceRoot?.name || projectRoot.rootId || "project";
}


export function resolveWorkspacePaths(
  relativeRoot: string,
  projectRelativePaths: readonly string[],
): string[] {
  return uniqueSorted(
    projectRelativePaths.map((projectRelativePath) =>
      joinRelativePath(relativeRoot, projectRelativePath),
    ),
  );
}


export function joinRelativePath(
  relativeRoot: string,
  projectRelativePath: string,
): string {
  const normalizedRoot = normalizeRelativeRoot(relativeRoot);

  const normalizedPath = normalizeRelativePath(projectRelativePath);

  if (!normalizedRoot) {
    return normalizedPath;
  }

  if (!normalizedPath) {
    return normalizedRoot;
  }

  /*
   * Avoid duplicating a root if a reader already returned a
   * workspace-relative path.
   */
  if (
    normalizedPath === normalizedRoot ||
    normalizedPath.startsWith(`${normalizedRoot}/`)
  ) {
    return normalizedPath;
  }

  return `${normalizedRoot}/${normalizedPath}`;
}


export function firstDeclaredValue(
  infos: readonly ProjectManifestInfo[],
  selector: (info: ProjectManifestInfo) => string | undefined,
): string | undefined {
  for (const info of infos) {
    const value = selector(info)?.trim();

    if (value) {
      return value;
    }
  }

  return undefined;
}


export function isWithinRelativeRoot(
  candidatePath: string,
  relativeRoot: string,
): boolean {
  const normalizedCandidate = normalizeRelativePath(candidatePath);

  const normalizedRoot = normalizeRelativeRoot(relativeRoot);

  if (!normalizedRoot) {
    return true;
  }

  return (
    normalizedCandidate === normalizedRoot ||
    normalizedCandidate.startsWith(`${normalizedRoot}/`)
  );
}


export function normalizeRelativeRoot(value: string): string {
  if (!value.trim()) {
    return "";
  }

  return normalizeRelativePath(value);
}


export function normalizeRelativePath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+/g, "/");

  const result = path.posix.normalize(normalized);

  if (result === ".") {
    return "";
  }

  return result.replace(/^\/+/, "");
}


export function pathDepth(relativePath: string): number {
  const normalized = normalizeRelativeRoot(relativePath);

  return normalized ? normalized.split("/").length : 0;
}


export function uniqueSorted(values: readonly string[]): string[] {
  return [
    ...new Set(values.map((value) => value.trim()).filter(Boolean)),
  ].sort((left, right) => left.localeCompare(right));
}


export function slug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\\/g, "/")
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/[\/]+/g, "-")
    .replace(/^-+|-+$/g, "");
}


export function compareWorkspaceFiles(
  left: WorkspaceFileEntry,
  right: WorkspaceFileEntry,
): number {
  const rootComparison = left.rootId.localeCompare(right.rootId);

  if (rootComparison !== 0) {
    return rootComparison;
  }

  return left.relativePath.localeCompare(right.relativePath);
}


export function sortProjects(projects: ProjectDefinition[]): void {
  projects.sort((left, right) => {
    const rootComparison = left.rootId.localeCompare(right.rootId);

    if (rootComparison !== 0) {
      return rootComparison;
    }

    return left.relativeRoot.localeCompare(right.relativeRoot);
  });
}


export function sortWarnings(warnings: ProjectCatalogWarning[]): void {
  warnings.sort((left, right) => {
    const pathComparison = left.path.localeCompare(right.path);

    if (pathComparison !== 0) {
      return pathComparison;
    }

    return left.code.localeCompare(right.code);
  });
}


export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
