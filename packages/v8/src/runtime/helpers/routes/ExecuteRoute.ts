import type { RouteBodyPlan } from "./types";

/**
 * Execute: agent_execute grant; 3A when planningDepth ≠ none;
 * enrich + turn + verify. Visible+planGate may suspend before mutate.
 */
export function executeRouteBody(params: {
  planningDepth: string;
  planGate: string;
}): RouteBodyPlan {
  const needsPlan =
    params.planningDepth === "visible" ||
    params.planningDepth === "internal";
  const suspendPlan =
    params.planningDepth === "visible" &&
    params.planGate === "required_before_execute";

  return {
    route: "execute",
    grantProfileHint: "agent_execute",
    runPlanPipeline: needsPlan,
    runEnrich: true,
    runTurnLoop: true,
    runVerify: true,
    exit: suspendPlan ? "suspend_plan_gate" : "continue_execute",
    reasonCodes: [
      "route_execute",
      ...(needsPlan ? ["route_execute_with_plan"] : ["route_execute_fast"]),
    ],
  };
}
