import type { ToolGrant } from "../../decision-policy";
import type { RepositoryStateReference } from "../../repository-state";
import { TOOL_RUNTIME_SCHEMA_VERSION } from "../../tool-runtime";

import type {
  VerificationCheckResult,
  VerificationDiffInspection,
  VerificationToolExecutorPort,
} from "../contracts";
import { DEFAULT_DIFF_PREVIEW_CHARS } from "../defaults";

export interface InspectDiffAndStaleRiskResult {
  diff: VerificationDiffInspection;
  warning?: string;
}

/**
 * Prefer the already-executed diff_review check output; otherwise optionally
 * call read_git_status when granted.
 */
export async function inspectDiffAndStaleRisk(params: {
  changedFiles: readonly string[];
  stateReadiness: "ready" | "degraded" | "unavailable";
  checks: readonly VerificationCheckResult[];
  toolOutputs: ReadonlyMap<string, unknown>;
  grant: ToolGrant;
  workspaceRoot: string;
  pinnedState: RepositoryStateReference;
  tools: VerificationToolExecutorPort;
  signal?: AbortSignal;
}): Promise<InspectDiffAndStaleRiskResult> {
  const staleStateRisk = params.stateReadiness !== "ready";
  const diffCheck = params.checks.find((check) => check.kind === "diff_review");

  let output: unknown;
  if (diffCheck?.toolCallId) {
    output = params.toolOutputs.get(diffCheck.toolCallId);
  } else if (params.grant.allowedTools.includes("read_git_status")) {
    const result = await params.tools.execute(
      {
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: "verify-diff-fallback",
        toolName: "read_git_status",
        arguments: {
          includeDiff: true,
          paths:
            params.changedFiles.length > 0
              ? [...params.changedFiles]
              : undefined,
        },
        grant: params.grant,
        workspaceRoot: params.workspaceRoot,
        pinnedState: params.pinnedState,
      },
      { signal: params.signal },
    );
    if (result.status === "succeeded") {
      output = result.output;
    }
  }

  const changedPaths = collectChangedPaths(output, params.changedFiles);
  const preview = extractDiffPreview(output);

  const reviewed = Boolean(output) || params.changedFiles.length > 0;
  const summary = staleStateRisk
    ? `Diff inspected with stale/degraded repository state risk (${params.stateReadiness}).`
    : reviewed
      ? `Diff inspected for ${changedPaths.length} path(s).`
      : "No diff available for inspection.";

  return {
    diff: {
      reviewed,
      staleStateRisk,
      summary,
      changedPaths,
      preview,
    },
    warning: staleStateRisk
      ? "Pinned repository state is not ready; verification evidence may be stale."
      : undefined,
  };
}

function collectChangedPaths(
  output: unknown,
  fallback: readonly string[],
): string[] {
  if (output && typeof output === "object") {
    const record = output as {
      staged?: unknown;
      unstaged?: unknown;
      untracked?: unknown;
    };
    const paths = [
      ...(Array.isArray(record.staged) ? record.staged : []),
      ...(Array.isArray(record.unstaged) ? record.unstaged : []),
      ...(Array.isArray(record.untracked) ? record.untracked : []),
    ].filter((value): value is string => typeof value === "string");
    if (paths.length > 0) {
      return [...new Set(paths)];
    }
  }
  return [...fallback];
}

function extractDiffPreview(output: unknown): string | undefined {
  if (!output || typeof output !== "object") return undefined;
  const diff = (output as { diff?: unknown }).diff;
  if (typeof diff !== "string" || diff.length === 0) return undefined;
  if (diff.length <= DEFAULT_DIFF_PREVIEW_CHARS) return diff;
  return `${diff.slice(0, DEFAULT_DIFF_PREVIEW_CHARS)}\n… [truncated]`;
}
