import type { RouteBodyPlan } from "./types";

/**
 * Plan route: research grant, always 3A, enrich optional for draft, no verify.
 * Completes (host Build starts later execute) — never auto-mutate.
 */
export function planRouteBody(): RouteBodyPlan {
  return {
    route: "plan",
    grantProfileHint: "research",
    runPlanPipeline: true,
    runEnrich: true,
    runTurnLoop: false,
    runVerify: false,
    exit: "complete",
    reasonCodes: ["route_plan"],
  };
}
