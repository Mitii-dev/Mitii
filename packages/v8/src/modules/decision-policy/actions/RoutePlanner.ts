import type { RequestUnderstandingResult } from "../../request-understanding";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  PlanningDepth,
  PlanGate,
} from "../contracts";
import { resolvePlanGate } from "./ResolvePlanGate";
import { resolvePlanningDepth } from "./ResolvePlanningDepth";
import { resolveRoute } from "./ResolveRoute";

export interface RoutePlanResult {
  route: ExecutionRoute;
  runDisposition: "continue" | "clarification_required";
  planningDepth: PlanningDepth;
  planGate: PlanGate;
  reasonCodes: DecisionReasonCode[];
}

/**
 * RoutePlanner: mode + understanding + message → route / plan depth / plan gate.
 * Does not authorize tools.
 */
export function planRoute(params: {
  mode: "ask" | "plan" | "agent";
  understanding: RequestUnderstandingResult;
  message: string;
  planApproval?: "policy" | "never";
}): RoutePlanResult {
  const routeResult = resolveRoute({
    mode: params.mode,
    understanding: params.understanding,
    message: params.message,
  });
  const depthResult = resolvePlanningDepth({
    mode: params.mode,
    route: routeResult.route,
    understanding: params.understanding,
    message: params.message,
  });
  const resolvedPlanGate = resolvePlanGate({
    mode: params.mode,
    route: routeResult.route,
    planningDepth: depthResult.planningDepth,
    understanding: params.understanding,
  });
  const planGateResult =
    params.planApproval === "never"
      ? { planGate: "none" as const, reasonCodes: ["plan_gate_none" as const] }
      : resolvedPlanGate;

  return {
    route: routeResult.route,
    runDisposition: routeResult.runDisposition,
    planningDepth: depthResult.planningDepth,
    planGate: planGateResult.planGate,
    reasonCodes: [
      ...routeResult.reasonCodes,
      ...depthResult.reasonCodes,
      ...planGateResult.reasonCodes,
    ],
  };
}
