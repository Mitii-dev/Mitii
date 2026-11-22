import type { ExecutionDecision, ToolGrant } from "../../../modules/decision-policy";
import { READ_ONLY_TOOL_IDS } from "../../../modules/decision-policy";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { DiagnosticSummary, RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { RepoBuildState, VerificationInput } from "../../../modules/verification";
import { VERIFICATION_SCHEMA_VERSION } from "../../../modules/verification";

import type { AgentEngineStartInput } from "../contracts";
import {
  inferLanguageFromPaths,
  isSafeRelativePlanningPath,
  normalizePlanningPath,
  uniqueStrings,
} from "./planningContext";

/**
 * Prefer host-supplied projects; otherwise infer a single root project from
 * changed-file extensions so language discovery can run.
 */
export function resolveVerificationProjects(
  input: AgentEngineStartInput,
): ProjectDescriptor[] {
  if (input.projects && input.projects.length > 0) {
    return [...input.projects];
  }
  return [
    {
      projectId: "workspace-root",
      rootPath: ".",
      primaryLanguageId: inferLanguageFromPaths(input.dirtyPaths ?? []),
      manifestPaths: [],
    },
  ];
}

/**
 * Read-only-command grant used only to capture a preflight snapshot before
 * Decision Policy has run (Agent execute, always-on). `pathScopes` covers
 * the whole workspace deliberately — no target narrowing exists yet.
 */
export function buildSyntheticPreflightGrant(_workspaceRoot: string): ToolGrant {
  return {
    maximumWorkspaceEffect: "read",
    allowedTools: [...READ_ONLY_TOOL_IDS],
    allowedEffects: ["workspace_read", "process_execute"],
    // Repo-root relative, matching how a real decision.toolGrant scopes
    // pathScopes (e.g. "."), not an absolute workspaceRoot path.
    pathScopes: ["."],
    approvalMode: "never",
    limits: { maxToolCalls: 0, maxWallTimeMs: 0, maxOutputBytes: 0 },
  };
}

export function buildPreflightVerificationInput(params: {
  decision?: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
  input: AgentEngineStartInput;
  pinnedState: RepositoryStateReference;
  verificationGrant: ToolGrant;
  contextPaths: readonly string[];
  pathScopes: readonly string[];
  mentionedPaths: readonly string[];
}): VerificationInput {
  const changedFiles = derivePreflightTargets({
    understanding: params.understanding,
    dirtyPaths: params.input.dirtyPaths ?? [],
    contextPaths: params.contextPaths,
    pathScopes: params.pathScopes,
    mentionedPaths: params.mentionedPaths,
  });
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    workspaceRoot: params.input.workspaceRoot!,
    pinnedState: params.pinnedState,
    changedFiles,
    projects: resolveVerificationProjects(params.input),
    verification: {
      required: true,
      minimumEvidence: uniqueVerificationEvidence([
        ...(params.decision?.verification.minimumEvidence ?? []),
        "diagnostics",
        "typecheck",
        "build",
      ]),
      allowUnavailable: true,
    },
    grant: params.verificationGrant,
    changeScope: params.understanding
      ? resolvePreflightChangeScope(params.understanding)
      : params.mentionedPaths.length > 0
        ? "module"
        : "cross_cutting",
    stateReadiness: params.input.repositoryState?.readiness ?? "ready",
  };
}

export function derivePreflightTargets(params: {
  understanding?: RequestUnderstandingResult;
  dirtyPaths: readonly string[];
  contextPaths: readonly string[];
  pathScopes: readonly string[];
  mentionedPaths: readonly string[];
}): string[] {
  const explicitTargets = (params.understanding?.taskAnalysis.targets ?? [])
    .filter((target) => target.explicit)
    .map((target) => target.value);
  const scopedCandidates = [
    ...explicitTargets,
    ...params.mentionedPaths,
    ...params.dirtyPaths,
    ...params.contextPaths,
  ];
  const normalized = scopedCandidates
    .map(normalizePlanningPath)
    .filter((path) => isSafeRelativePlanningPath(path));
  const specific = uniqueStrings(normalized).slice(0, 32);
  if (specific.length > 0) {
    return specific;
  }
  return uniqueStrings(
    params.pathScopes
      .map(normalizePlanningPath)
      .filter((path) => isSafeRelativePlanningPath(path)),
  ).slice(0, 32);
}

/**
 * Explicit "@path" mentions in the raw user query. Used only to scope the
 * preflight build-state capture that runs before Request Understanding
 * exists (so it has no `taskAnalysis.targets` yet) — without this, that
 * capture's `changedFiles` falls back to the repo root and never discovers
 * a real per-package build/typecheck check via nearby-manifest expansion.
 */
export function extractMentionedPaths(query: string): string[] {
  const matches = query.matchAll(/@([^\s,;:)]+)/g);
  return [...matches].map((match) => match[1] ?? "").filter(Boolean);
}

export function resolvePreflightChangeScope(
  understanding: RequestUnderstandingResult,
): VerificationInput["changeScope"] {
  const scope = understanding.taskAnalysis.scope;
  if (scope === "repository" || scope === "workspace") {
    return "cross_cutting";
  }
  if (scope === "package" || scope === "multi_file") {
    return "module";
  }
  return "localized";
}

export function uniqueVerificationEvidence(
  values: readonly VerificationInput["verification"]["minimumEvidence"][number][],
): VerificationInput["verification"]["minimumEvidence"] {
  return [...new Set(values)];
}

/**
 * Capped preflight-diagnostic hint for the understanding LLM. Best-effort
 * scope match against the raw query text only — understanding hasn't run
 * yet, so there is no targets list to match against. The authoritative
 * in-scope count for strategy rules is computed later, post-understanding,
 * against full evidence.targets (see evidenceScope.ts).
 */
export function buildDiagnosticSummary(
  state: RepoBuildState,
  query: string,
): DiagnosticSummary | undefined {
  const errors = state.diagnostics.filter(
    (diagnostic) => diagnostic.severity === "error",
  );
  if (errors.length === 0) {
    return undefined;
  }
  const normalizedQuery = query.toLowerCase();
  const inScopeErrorCount = errors.filter((diagnostic) =>
    normalizedQuery.includes(diagnostic.path.toLowerCase()),
  ).length;
  return {
    errorCount: errors.length,
    inScopeErrorCount,
    diagnostics: errors.slice(0, 12).map((diagnostic) => ({
      path: diagnostic.path,
      ...(diagnostic.code ? { code: diagnostic.code } : {}),
      message: diagnostic.message.slice(0, 300),
    })),
  };
}
