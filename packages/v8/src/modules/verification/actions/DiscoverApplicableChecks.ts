import type { LanguageId, ProjectDescriptor } from "../../repository-state";

import type {
  VerificationChangeScope,
  VerificationCheckKind,
  VerificationManifestReaderPort,
} from "../contracts";
import { CHECK_KINDS_BY_SCOPE, CHECK_KIND_PRIORITY } from "../policy";
import {
  discoverCandidatesForProject,
  type DiscoveredCheckCandidate,
} from "../internal/discovery";

export type { DiscoveredCheckCandidate };

export interface DiscoverApplicableChecksResult {
  candidates: DiscoveredCheckCandidate[];
  warnings: string[];
}

/**
 * Discover applicable checks from trusted project metadata for affected
 * projects, filtered by change-scope kind allowance.
 */
export async function discoverApplicableChecks(params: {
  projects: readonly ProjectDescriptor[];
  changeScope: VerificationChangeScope;
  changedFiles: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<DiscoverApplicableChecksResult> {
  const allowed = new Set<VerificationCheckKind>(
    CHECK_KINDS_BY_SCOPE[params.changeScope],
  );
  const candidates: DiscoveredCheckCandidate[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();
  const discoveryProjects = await expandWithNearbyManifestProjects({
    projects: params.projects,
    changedFiles: params.changedFiles,
    manifests: params.manifests,
  });

  for (const project of discoveryProjects) {
    const discovered = await discoverCandidatesForProject({
      project,
      changedFiles: params.changedFiles,
      manifests: params.manifests,
    });
    for (const candidate of discovered.candidates) {
      if (!allowed.has(candidate.kind)) {
        continue;
      }
      if (seen.has(candidate.checkId)) {
        continue;
      }
      seen.add(candidate.checkId);
      candidates.push(candidate);
    }
    warnings.push(...discovered.warnings);
  }

  // Always allow diagnostics + diff_review as Tool Runtime backed checks when in scope.
  if (allowed.has("diagnostics") && !seen.has("diagnostics:workspace")) {
    candidates.push({
      checkId: "diagnostics:workspace",
      kind: "diagnostics",
      label: "Read workspace diagnostics",
      evidenceSource: "tool:read_diagnostics",
      toolName: "read_diagnostics",
      toolArguments: {
        paths: params.changedFiles.length > 0 ? [...params.changedFiles] : undefined,
      },
      languageId: "unknown" as LanguageId,
    });
  }

  if (allowed.has("diff_review") && !seen.has("diff_review:workspace")) {
    candidates.push({
      checkId: "diff_review:workspace",
      kind: "diff_review",
      label: "Inspect git status and diff",
      evidenceSource: "tool:read_git_status",
      toolName: "read_git_status",
      toolArguments: {
        includeDiff: true,
        paths:
          params.changedFiles.length > 0 ? [...params.changedFiles] : undefined,
      },
      languageId: "unknown" as LanguageId,
    });
  }

  candidates.sort((a, b) => {
    const ai = CHECK_KIND_PRIORITY.indexOf(a.kind);
    const bi = CHECK_KIND_PRIORITY.indexOf(b.kind);
    return ai - bi;
  });

  return { candidates, warnings };
}

async function expandWithNearbyManifestProjects(params: {
  projects: readonly ProjectDescriptor[];
  changedFiles: readonly string[];
  manifests: VerificationManifestReaderPort;
}): Promise<ProjectDescriptor[]> {
  const projects = [...params.projects];
  const knownRoots = new Set(
    projects.map((project) => normalizePath(project.rootPath)),
  );

  for (const file of params.changedFiles) {
    for (const rootPath of candidatePackageRoots(file)) {
      if (knownRoots.has(rootPath)) {
        continue;
      }
      const manifestPath =
        rootPath === "." ? "package.json" : `${rootPath}/package.json`;
      if (!(await params.manifests.exists(manifestPath))) {
        continue;
      }
      knownRoots.add(rootPath);
      projects.push({
        projectId: `inferred:${rootPath}`,
        rootPath,
        primaryLanguageId: inferLanguageFromPath(file),
        ecosystemId: "node",
        manifestPaths: [manifestPath],
      });
    }
  }

  return projects;
}

const CANDIDATE_FILE_LIKE = /\.\w{1,16}$/;

function candidatePackageRoots(filePath: string): string[] {
  const normalized = normalizePath(filePath);
  const parts = normalized.split("/").filter(Boolean);
  // Only strip the last segment when it looks like a file (has an
  // extension). A folder-shaped path — e.g. an explicit "packages/x"
  // target with no file component — is itself a valid candidate root and
  // must not be discarded before the walk-up.
  if (
    parts.length > 0 &&
    CANDIDATE_FILE_LIKE.test(parts[parts.length - 1]!)
  ) {
    parts.pop();
  }

  const roots: string[] = [];
  while (parts.length > 0) {
    roots.push(parts.join("/"));
    parts.pop();
  }
  roots.push(".");
  return roots;
}

function inferLanguageFromPath(filePath: string): LanguageId {
  const normalized = filePath.toLowerCase();
  if (/\.(ts|tsx)\b/.test(normalized)) return "typescript";
  if (/\.(js|jsx|mjs|cjs)\b/.test(normalized)) return "javascript";
  return "unknown" as LanguageId;
}

function normalizePath(path: string): string {
  return (
    path.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/$/, "") || "."
  );
}
