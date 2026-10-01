import type { LanguageId, ProjectDescriptor } from "../../repository-state";

import type {
  VerificationChangeScope,
  VerificationCheckKind,
  VerificationManifestReaderPort,
} from "../contracts";
import { SYNTAX_PORT_EVIDENCE } from "../contracts";
import { CHECK_KINDS_BY_SCOPE, CHECK_KIND_PRIORITY } from "../policy";
import {
  discoverCandidatesForProject,
  type DiscoveredCheckCandidate,
} from "../internal/discovery";
import { readVerificationScriptHints } from "../internal/readVerificationScriptHints";

export type { DiscoveredCheckCandidate };

export interface DiscoverApplicableChecksResult {
  candidates: DiscoveredCheckCandidate[];
  warnings: string[];
  /** Script/token hints from AGENTS.md etc. — never invent checks from these. */
  scriptHints: string[];
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
  /** When true, emit a port-backed tree-sitter syntax candidate. */
  syntaxPortAvailable?: boolean;
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
      changeScope: params.changeScope,
    });
    for (const candidate of discovered.candidates) {
      if (!allowed.has(candidate.kind)) {
        continue;
      }
      // Prefer host tree-sitter over spawned py_compile/node --check/bash -n.
      if (
        params.syntaxPortAvailable &&
        candidate.kind === "syntax" &&
        candidate.evidenceSource !== SYNTAX_PORT_EVIDENCE
      ) {
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

  if (
    params.syntaxPortAvailable &&
    allowed.has("syntax") &&
    !seen.has("syntax:port")
  ) {
    candidates.unshift({
      checkId: "syntax:port",
      kind: "syntax",
      label: "Tree-sitter syntax check",
      evidenceSource: SYNTAX_PORT_EVIDENCE,
      toolName: "run_readonly_command",
      toolArguments: {
        paths:
          params.changedFiles.length > 0 ? [...params.changedFiles] : undefined,
      },
      languageId: "unknown" as LanguageId,
    });
    seen.add("syntax:port");
  }

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

  const scriptHints = await readVerificationScriptHints(params.manifests);

  return {
    candidates,
    scriptHints,
    warnings: suppressCoveredRootDiscoveryWarnings({
      warnings,
      candidates,
      projects: discoveryProjects,
    }),
  };
}

const ROOT_NO_SCRIPT_WARNING =
  /has no discoverable typecheck\/lint\/test\/build scripts/;

function suppressCoveredRootDiscoveryWarnings(params: {
  warnings: readonly string[];
  candidates: readonly DiscoveredCheckCandidate[];
  projects: readonly ProjectDescriptor[];
}): string[] {
  const descendantCovered = params.candidates.some(
    (candidate) =>
      candidate.projectId &&
      !isWorkspaceRootProject(candidate.projectId, params.projects),
  );
  if (!descendantCovered) {
    return [...params.warnings];
  }

  const rootProjectIds = new Set(
    params.projects
      .filter((project) => isWorkspaceRootPath(project.rootPath))
      .map((project) => project.projectId),
  );
  if (rootProjectIds.size === 0) {
    return [...params.warnings];
  }

  return params.warnings.filter((warning) => {
    if (!ROOT_NO_SCRIPT_WARNING.test(warning)) {
      return true;
    }
    return ![...rootProjectIds].some((projectId) =>
      warning.includes(`project "${projectId}"`),
    );
  });
}

function isWorkspaceRootProject(
  projectId: string,
  projects: readonly ProjectDescriptor[],
): boolean {
  const project = projects.find((entry) => entry.projectId === projectId);
  return project ? isWorkspaceRootPath(project.rootPath) : false;
}

function isWorkspaceRootPath(rootPath: string): boolean {
  return normalizePath(rootPath) === ".";
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
