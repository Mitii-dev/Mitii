import type { RequestUnderstandingResult } from "../../request-understanding";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  PlanGate,
  PlanningDepth,
} from "../contracts";

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
  const { mode, route, planningDepth, understanding } = params;
  const reasonCodes: DecisionReasonCode[] = [];
  const { taskAnalysis } = understanding;

  // Plan-only / ask never mutate, so no execute gate.
  if (mode !== "agent" || route !== "execute") {
    reasonCodes.push("plan_gate_none");
    return { planGate: "none", reasonCodes };
  }

  if (planningDepth !== "visible") {
    reasonCodes.push("plan_gate_none");
    return { planGate: "none", reasonCodes };
  }

  const elevatedRisk =
    taskAnalysis.risk === "high" || taskAnalysis.risk === "critical";
  const broadScope =
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace" ||
    taskAnalysis.scope === "package";
  const veryComplex = taskAnalysis.complexity === "very_complex";

  if (elevatedRisk || broadScope || veryComplex) {
    reasonCodes.push("plan_gate_required");
    return { planGate: "required_before_execute", reasonCodes };
  }

  reasonCodes.push("plan_gate_none");
  return { planGate: "none", reasonCodes };
}
