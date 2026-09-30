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

/** Soft nudge after too many read-only turns with zero mutations. Does not spend evidence reads. */
export function softMutationNudgeMessage(
  readOnlyTurns: number,
  opts?: { vcsHistoryRewrite?: boolean },
): string {
  if (opts?.vcsHistoryRewrite) {
    return [
      `You have completed ${readOnlyTurns} read-only tool turns without fixing git history.`,
      "Call git_signoff_range with the exclusive base from the DCO error (optionally push: true).",
      "Do not edit .github/workflows/dco.yml or keep rediscovering with more reads.",
    ].join("\n");
  }
  return [
    `You have completed ${readOnlyTurns} read-only tool turns without a workspace edit.`,
    "Call apply_patch (or another mutating tool) for the paths named in the user request.",
    "Do not keep rediscovering with more reads/searches.",
  ].join("\n");
}

export function unfulfilledExecuteNudgeMessage(opts?: {
  vcsHistoryRewrite?: boolean;
}): string {
  if (opts?.vcsHistoryRewrite) {
    return [
      "This execute route still requires a git history fix (Signed-off-by / DCO).",
      "Call git_signoff_range now, or give a short Blocker if you cannot.",
    ].join("\n");
  }
  return [
    "This execute route still requires a workspace mutation.",
    "Call apply_patch now, or give a short Blocker if you cannot edit.",
  ].join("\n");
}
