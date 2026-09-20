import type { ModelToolDefinition } from "../../../modules/model-gateway";

import { isUpdateTodosTool } from "../internal/updateTodosRuntime";
import { DEFAULT_MUTATING_TOOL_NAMES } from "./executeToolSupport";

/** Broad rediscovery — blocked while mutation discipline is active. */
export const MUTATION_LOCK_BROAD_DISCOVERY_TOOLS = new Set([
  "list_directory",
  "directory_tree",
  "glob_files",
  "search_files",
  "run_readonly_command",
  "read_git_status",
  "read_git_log",
  "read_git_show",
  "read_git_branches",
  "file_metadata",
  /** Workspace-wide symbol search restarts exploration; caret tools stay. */
  "workspace_symbol",
]);

/**
 * Targeted evidence reads — kept available; turn caps enforce the budget.
 * Includes caret/file code-intelligence so symbol resolution stays usable
 * while broad rediscovery is locked.
 */
export const MUTATION_LOCK_EVIDENCE_READ_TOOLS = new Set([
  "read_file",
  "read_many_files",
  "read_diagnostics",
  "goto_definition",
  "find_references",
  "hover_symbol",
  "document_symbol",
  "find_implementation",
  "call_hierarchy",
  "analyze_change_impact",
]);

/**
 * While awaiting the first mutation, strip broad discovery tools so the model
 * cannot restart exploration. Keep apply_patch* and targeted read_file so a
 * missing write-path can still be loaded before the patch (BillBuddy 22:38).
 */
export function filterToolsForMutationLock(
  tools: readonly ModelToolDefinition[] | undefined,
): ModelToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return tools as ModelToolDefinition[] | undefined;
  }
  const filtered = tools.filter(
    (tool) =>
      DEFAULT_MUTATING_TOOL_NAMES.has(tool.name) ||
      isUpdateTodosTool(tool.name) ||
      MUTATION_LOCK_EVIDENCE_READ_TOOLS.has(tool.name) ||
      !MUTATION_LOCK_BROAD_DISCOVERY_TOOLS.has(tool.name),
  );
  // Prefer an explicit allow-list when the catalog is large (MCP noise).
  const preferred = tools.filter(
    (tool) =>
      DEFAULT_MUTATING_TOOL_NAMES.has(tool.name) ||
      isUpdateTodosTool(tool.name) ||
      MUTATION_LOCK_EVIDENCE_READ_TOOLS.has(tool.name),
  );
  if (preferred.length > 0) {
    return preferred;
  }
  return filtered.length > 0 ? filtered : (tools as ModelToolDefinition[]);
}

/**
 * Evidence budget exhausted: advertise only mutating tools (+ update_todos)
 * so the model cannot keep proposing read_file calls that fail closed.
 */
export function filterToolsForMutationOnly(
  tools: readonly ModelToolDefinition[] | undefined,
): ModelToolDefinition[] | undefined {
  if (!tools || tools.length === 0) {
    return tools as ModelToolDefinition[] | undefined;
  }
  const preferred = tools.filter(
    (tool) =>
      DEFAULT_MUTATING_TOOL_NAMES.has(tool.name) ||
      isUpdateTodosTool(tool.name),
  );
  return preferred.length > 0 ? preferred : (tools as ModelToolDefinition[]);
}

/**
 * True when the loop should advertise the mutation-discipline tool set
 * (no broad rediscovery). Evidence-read turn caps are enforced separately.
 */
export function isMutationLocked(params: {
  awaitingReadOnlyMutationRetry: boolean;
  postNudgeEvidenceReadTurns: number;
  maxPostNudgeEvidenceReadTurns: number;
}): boolean {
  return params.awaitingReadOnlyMutationRetry === true;
}

/** Evidence budget remaining after the mutation nudge / Continue. */
export function remainingPostNudgeEvidenceReads(params: {
  postNudgeEvidenceReadTurns: number;
  maxPostNudgeEvidenceReadTurns: number;
}): number {
  return Math.max(
    0,
    params.maxPostNudgeEvidenceReadTurns - params.postNudgeEvidenceReadTurns,
  );
}

/**
 * Initial consumed evidence-read count when entering a mutation-locked loop.
 *
 * - First Continue (overrideCount === 1): full allowance (used = 0).
 * - Later Continues: zero remaining (used = max) — BillBuddy 17:54 kept
 *   rediscovering after the second Continue.
 * - Verification repair lock: zero remaining (errors already in prompt).
 */
export function initialPostNudgeEvidenceReadsUsed(params: {
  forceMutationOnResume: boolean;
  forceMutationLock: boolean;
  continueOverrideCount: number;
  maxPostNudgeEvidenceReadTurns: number;
}): number {
  const max = params.maxPostNudgeEvidenceReadTurns;
  if (params.forceMutationOnResume) {
    return params.continueOverrideCount >= 2 ? max : 0;
  }
  if (params.forceMutationLock) {
    return max;
  }
  return 0;
}
