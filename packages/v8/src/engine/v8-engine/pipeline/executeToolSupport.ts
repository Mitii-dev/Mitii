/**
 * Tool-execution support: mutating names, diagnostics, network hosts, grant refresh.
 */
import type { ToolResult } from "../../tool-runtime";

import type { RunEvent } from "../contracts";
import { DEFAULT_MUTATION_TOOL_DEFINITIONS } from "../legacy/policy";

export const DEFAULT_MUTATING_TOOL_NAMES = new Set(
  DEFAULT_MUTATION_TOOL_DEFINITIONS.map((tool) => tool.name),
);

/** Process-level git history / PR tools that satisfy execute without file diffs. */
export const GIT_WRITE_TOOL_NAMES = new Set([
  "git_signoff_range",
  "create_pull_request",
]);

export function isGitWriteToolName(name: string): boolean {
  return GIT_WRITE_TOOL_NAMES.has(name);
}

export function safeJsonParse(value: string): unknown {
  try {
    return value.trim().length > 0 ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

export function truncateForLogField(value: string, maxChars: number): string {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= maxChars) {
    return compact;
  }
  return `${compact.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function toolCompletionDiagnostics(
  result: ToolResult,
): Partial<Extract<RunEvent, { type: "tool_completed" }>> {
  const warnings = result.warnings
    .map((warning) => truncateForLogField(warning, 500))
    .filter((warning) => warning.length > 0)
    .slice(0, 5);
  const outputPreview = result.audit.outputPreview
    ? truncateForLogField(result.audit.outputPreview, 1_000)
    : undefined;

  return {
    ...(result.reasonCode ? { reasonCode: result.reasonCode } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(outputPreview ? { outputPreview } : {}),
    durationMs: result.durationMs,
    bytesProduced: result.bytesProduced,
    truncated: result.truncated,
    redacted: result.redacted,
  };
}

export {
  extractHostsFromWebSearchOutput,
  expandRelatedNetworkHosts,
  inferPackageRegistryHostsFromQuery,
} from "./executeToolNetworkHosts";
export {
  refreshAuthorityAfterTools,
  type GrantRefreshOutcome,
} from "./executeToolGrantRefresh";
