import type { RequestUnderstandingResult } from "../../request-understanding";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  PlanGate,
  PlanningDepth,
} from "../contracts";
import { EXECUTION_ROUTE } from "../constants";

export interface PlanGateResolution {
  planGate: PlanGate;
  reasonCodes: DecisionReasonCode[];
}

/**
 * Decide whether execute must suspend for plan approval.
 * Dimension-driven: visible depth + mutate route + elevated risk/scope.
 */
export function resolvePlanGate(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  planningDepth: PlanningDepth;
  understanding: RequestUnderstandingResult;
}): PlanGateResolution {
  const { mode, route, planningDepth } = params;
  const reasonCodes: DecisionReasonCode[] = [];

  // Plan-only / ask never mutate, so no execute gate.
  if (mode !== "agent" || route !== EXECUTION_ROUTE.EXECUTE) {
    reasonCodes.push("plan_gate_none");
    return { planGate: "none", reasonCodes };
  }

  if (planningDepth !== "visible") {
    reasonCodes.push("plan_gate_none");
    return { planGate: "none", reasonCodes };
  }

  // Visible Agent execute always gates before mutate. Hosts may still suppress
  // via planApproval: never (plan_gate_suppressed_by_policy).
  reasonCodes.push("plan_gate_required");
  return { planGate: "required_before_execute", reasonCodes };
}
