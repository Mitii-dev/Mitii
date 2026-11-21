import type { ExecutionDecision } from "../../../modules/decision-policy";

import type { AgentEngineStartInput } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";

/**
 * Hosts that auto-approve mutations (`approvalMode: never`: --approve,
 * automation, pilot) have no human to review a plan, so the plan gate must not
 * suspend either unless the host explicitly asked for `planApproval: policy`.
 */
export function resolveEffectivePlanApproval(
  input: Pick<AgentEngineStartInput, "planApproval" | "approvalMode">,
): "policy" | "never" | undefined {
  if (input.planApproval) return input.planApproval;
  return input.approvalMode === "never" ? "never" : undefined;
}

export const PLAN_GATE_AUTO_APPROVED_WARNING =
  "Plan review was auto-approved by host policy (planApproval: never / --approve / automation); execution continues without pausing for plan approval. Use an approval mode other than never to review the plan first.";

/** Informational notice when policy removed a gate that risk analysis required. */
export function noteAutoApprovedPlanGate(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    bus: EventBus;
    warnings: string[];
    decision: ExecutionDecision;
  },
): void {
  if (
    params.decision.planningDepth !== "visible" ||
    !params.decision.reasonCodes.includes("plan_gate_suppressed_by_policy")
  ) {
    return;
  }
  params.warnings.push(PLAN_GATE_AUTO_APPROVED_WARNING);
  runtime.emit(params.bus, {
    type: "warning",
    runId: params.runId,
    message: PLAN_GATE_AUTO_APPROVED_WARNING,
    at: runtime.isoNow(),
  });
}
