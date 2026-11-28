/**
 * Mutate-lock soft rail — narrow tool surface until evidence is ready.
 */
import type { ModelToolDefinition } from "../../../../modules/model-gateway";

/** Workspace / git mutation tools retained under mutate lock. */
export const MUTATE_LOCK_MUTATION_TOOL_NAMES = new Set([
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
  "git_signoff_range",
  "create_pull_request",
]);

/** Narrow reads allowed while evidence is still catching up (not broad discovery). */
export const MUTATE_LOCK_TARGETED_READ_TOOL_NAMES = new Set([
  "read_file",
  "read_many_files",
  "update_todos",
]);

/**
 * Allowed under mutate lock so change_impact_recommended can be satisfied
 * without unlocking search/list discovery.
 */
export const MUTATE_LOCK_SUPPORT_TOOL_NAMES = new Set([
  "analyze_change_impact",
  "plan_check_change_impact",
]);

export function isMutateLockAllowedToolName(
  name: string,
  opts?: { allowTargetedReads?: boolean },
): boolean {
  if (MUTATE_LOCK_MUTATION_TOOL_NAMES.has(name)) {
    return true;
  }
  if (MUTATE_LOCK_SUPPORT_TOOL_NAMES.has(name)) {
    return true;
  }
  if (opts?.allowTargetedReads === false) {
    return false;
  }
  return MUTATE_LOCK_TARGETED_READ_TOOL_NAMES.has(name);
}

/**
 * Strip discovery tools (search/list/glob/tree/run_command/…). Keep mutate
 * tools, analyze_change_impact, and optionally targeted reads.
 */
export function filterToolsForMutateLock(
  tools: readonly ModelToolDefinition[] | undefined,
  opts?: { allowTargetedReads?: boolean },
): ModelToolDefinition[] | undefined {
  if (!tools) {
    return tools;
  }
  return tools.filter((tool) =>
    isMutateLockAllowedToolName(tool.name, opts),
  );
}

/**
 * Model-request fields for a mutate-lock turn.
 * When targeted reads are off, use toolChoice "required" so the model must
 * call apply_patch (or another retained mutate/support tool) rather than
 * stalling on text-only / rediscovery.
 */
export function mutateLockModelRequestFields(
  tools: readonly ModelToolDefinition[] | undefined,
  opts?: { allowTargetedReads?: boolean },
): {
  tools: ModelToolDefinition[] | undefined;
  toolChoice: "auto" | "required";
} {
  const filtered = filterToolsForMutateLock(tools, opts);
  const forceTool =
    opts?.allowTargetedReads === false &&
    (filtered?.length ?? 0) > 0;
  return {
    tools: filtered,
    toolChoice: forceTool ? "required" : "auto",
  };
}

/**
 * After evidence gate or patch demand: arm mutate lock.
 * Ready → strip targeted reads too. Not ready (gate budget spent) → keep
 * read_file/read_many_files for the last named paths.
 */
export function resolveMutateLockAllowTargetedReads(params: {
  readinessReady: boolean;
  evidenceGateActive: boolean;
}): boolean {
  if (params.evidenceGateActive) {
    return true;
  }
  return !params.readinessReady;
}

/** Continue after unfulfilled/readonly thrash should re-arm mutate lock. */
export function shouldRearmMutateLockOnContinue(params: {
  wallReason?: string;
  changedFileCount: number;
  mutationRequired: boolean;
  reasonCodes?: readonly string[];
}): boolean {
  if (!params.mutationRequired || params.changedFileCount > 0) {
    return false;
  }
  // Engine clarify wall: do NOT force mutate lock — need an explicit path first.
  if (params.wallReason === "evidence_clarify") {
    return false;
  }
  const codes = params.reasonCodes ?? [];
  if (codes.includes("evidence_recovery_exhausted")) {
    return false;
  }
  if (params.wallReason === "unfulfilled_execute") {
    return true;
  }
  return (
    codes.includes("readonly_thrash_continue") ||
    codes.includes("step_mutate_lock_armed") ||
    codes.includes("step_mutate_patch_required")
  );
}
