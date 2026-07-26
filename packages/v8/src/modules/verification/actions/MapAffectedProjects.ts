import type { LanguageId, ProjectDescriptor } from "../../repository-state";

import type { VerificationChangeScope } from "../contracts";

export interface AffectedProjectMapping {
  projects: ProjectDescriptor[];
  unmatchedFiles: string[];
  reasonCodes: Array<"narrow_scope_selected" | "expanded_scope_selected">;
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

function projectContainsFile(
  project: ProjectDescriptor,
  relativeFile: string,
): boolean {
  const root = normalizePath(project.rootPath).replace(/\/$/, "");
  const file = normalizePath(relativeFile);
  if (root === "." || root === "") {
    return true;
  }
  return file === root || file.startsWith(`${root}/`);
}

/**
 * Map changed files onto Repository State project descriptors.
 * Cross-cutting / public_api scopes include all provided projects when any
 * file is unmatched or multiple ecosystems are touched.
 */
export function mapAffectedProjects(params: {
  changedFiles: readonly string[];
  projects: readonly ProjectDescriptor[];
  changeScope: VerificationChangeScope;
}): AffectedProjectMapping {
  const projects = [...params.projects];
  const unmatchedFiles: string[] = [];
  const matched = new Map<string, ProjectDescriptor>();

  if (projects.length === 0) {
    return {
      projects: [],
      unmatchedFiles: [...params.changedFiles],
      reasonCodes:
        params.changeScope === "localized" || params.changeScope === "module"
          ? ["narrow_scope_selected"]
          : ["expanded_scope_selected"],
    };
  }

  for (const file of params.changedFiles) {
    const hits = projects.filter((project) =>
      projectContainsFile(project, file),
    );
    if (hits.length === 0) {
      unmatchedFiles.push(file);
      continue;
    }
    // Prefer the longest (most specific) root match.
    hits.sort(
      (a, b) =>
        normalizePath(b.rootPath).length - normalizePath(a.rootPath).length,
    );
    const best = hits[0]!;
    matched.set(best.projectId, best);
  }

  const expand =
    params.changeScope === "cross_cutting" ||
    params.changeScope === "public_api" ||
    unmatchedFiles.length > 0;

  if (expand && params.changedFiles.length > 0) {
    return {
      projects,
      unmatchedFiles,
      reasonCodes: ["expanded_scope_selected"],
    };
  }

  if (matched.size === 0 && params.changedFiles.length === 0) {
    return {
      projects,
      unmatchedFiles,
      reasonCodes: ["expanded_scope_selected"],
    };
  }

  return {
    projects: [...matched.values()],
    unmatchedFiles,
    reasonCodes: ["narrow_scope_selected"],
  };
}

export function languagesForProjects(
  projects: readonly ProjectDescriptor[],
): LanguageId[] {
  return [...new Set(projects.map((project) => project.primaryLanguageId))];
}
