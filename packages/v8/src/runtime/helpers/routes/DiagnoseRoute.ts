import type { RouteBodyPlan } from "./types";

/**
 * Diagnose: research grant, enrich + turn loop, no mutate, no 3A.
 * ImpactMap lands in Store; promote only via upgrade plate.
 */
export function diagnoseRouteBody(): RouteBodyPlan {
  return {
    route: "diagnose",
    grantProfileHint: "research",
    runPlanPipeline: false,
    runEnrich: true,
    runTurnLoop: true,
    runVerify: false,
    exit: "complete",
    reasonCodes: ["route_diagnose"],
  };
}
