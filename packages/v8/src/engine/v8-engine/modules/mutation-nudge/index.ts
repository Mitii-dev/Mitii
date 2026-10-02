import type { ExecutionDecision } from "../../../../modules/decision-policy";
import type { ModelToolCall } from "../../../../modules/model-gateway";
import { DEFAULT_MUTATING_TOOL_NAMES } from "../../pipeline/executeTool";

export function requiresMutation(decision: ExecutionDecision): boolean {
  return (
    decision.route === "execute" &&
    decision.toolGrant.maximumWorkspaceEffect === "write"
  );
}

export function batchIncludesMutatingTool(
  calls: readonly ModelToolCall[],
): boolean {
  return calls.some((call) => DEFAULT_MUTATING_TOOL_NAMES.has(call.name));
}

export function batchIsReadonlyTools(
  calls: readonly ModelToolCall[],
): boolean {
  if (calls.length === 0) return false;
  return calls.every(
    (call) =>
      call.name === "update_todos" ||
      !DEFAULT_MUTATING_TOOL_NAMES.has(call.name),
  );
}

/**
 * True when this run already drafted a plan — use the tighter post-plan
 * readonly threshold so we do not rediscover forever after plan-then-finish.
 */
export function hasPlanDraftedThisRun(params: {
  planningDepth?: string;
  reasonCodes?: readonly string[];
}): boolean {
  if (
    params.planningDepth === "visible" ||
    params.planningDepth === "internal"
  ) {
    return true;
  }
  const codes = params.reasonCodes ?? [];
  return (
    codes.includes("plan_drafted") ||
    codes.includes("plan_approved") ||
    codes.includes("plan_carried") ||
    codes.includes("officer_task_size_plan") ||
    codes.includes("task_list_seeded")
  );
}

export function resolveReadonlyTurnsBeforeMutationNudge(params: {
  hasPlan: boolean;
  maxReadOnlyTurnsBeforeMutationNudge: number;
  maxReadOnlyTurnsBeforeMutationNudgeAfterPlan: number;
}): number {
  if (!params.hasPlan) {
    return params.maxReadOnlyTurnsBeforeMutationNudge;
  }
  return Math.min(
    params.maxReadOnlyTurnsBeforeMutationNudge,
    params.maxReadOnlyTurnsBeforeMutationNudgeAfterPlan,
  );
}

export function shouldEscalateReadonlyThrashToContinue(params: {
  softMutationNudges: number;
  maxSoftMutationNudgesBeforeContinue: number;
  changedFileCount: number;
  gitWriteSucceeded?: boolean;
}): boolean {
  if (params.changedFileCount > 0 || params.gitWriteSucceeded) {
    return false;
  }
  if (params.maxSoftMutationNudgesBeforeContinue <= 0) {
    return false;
  }
  // Allow `max` soft patch demands before Continue (escalate only after exceeding).
  return params.softMutationNudges > params.maxSoftMutationNudgesBeforeContinue;
}

/** Soft nudge after too many read-only turns with zero mutations. Does not spend evidence reads. */
export function softMutationNudgeMessage(
  readOnlyTurns: number,
  opts?: { vcsHistoryRewrite?: boolean; hasPlan?: boolean },
): string {
  if (opts?.vcsHistoryRewrite) {
    return [
      `You have completed ${readOnlyTurns} read-only tool turns without fixing git history.`,
      "Call git_signoff_range with the exclusive base from the DCO error (optionally push: true).",
      "Do not edit .github/workflows/dco.yml or keep rediscovering with more reads.",
      "History rewrite is not done until git_signoff_range succeeds.",
    ].join("\n");
  }
  const planLine = opts?.hasPlan
    ? "A plan/checklist is already drafted — pick the next open change surface and patch it."
    : "Prefer the paths named in the user request or active checklist.";
  return [
    `You have completed ${readOnlyTurns} read-only tool turns without a workspace edit.`,
    "Workspace edits are NOT done. Do not summarize as finished.",
    "Call apply_patch (or another mutating tool) for the next bounded change now.",
    planLine,
    "Do not keep rediscovering with more reads/searches.",
  ].join("\n");
}

/**
 * Honest partial answer when readonly thrash forces a Continue wall with
 * zero mutations — never claim edits completed.
 */
export function readonlyThrashPartialAnswer(params: {
  hasPlan?: boolean;
  fileReadCalls?: number;
}): string {
  const planBit = params.hasPlan
    ? "A plan was drafted, but "
    : "";
  const reads =
    typeof params.fileReadCalls === "number" && params.fileReadCalls > 0
      ? ` (after ${params.fileReadCalls} file reads)`
      : "";
  return (
    `${planBit}no workspace edits have been applied yet${reads}. ` +
    "Continue when you want me to start patching the next checklist step, or stop here."
  );
}

export function unfulfilledExecuteNudgeMessage(opts?: {
  vcsHistoryRewrite?: boolean;
}): string {
  if (opts?.vcsHistoryRewrite) {
    return [
      "This execute route still requires a git history fix (Signed-off-by / DCO).",
      "Call git_signoff_range now, or give a short Blocker if you cannot.",
      "Do not claim the history fix is done until that tool succeeds.",
    ].join("\n");
  }
  return [
    "This execute route still requires a workspace mutation.",
    "Edits are not done. Call apply_patch now, or give a short Blocker if you cannot edit.",
  ].join("\n");
}
