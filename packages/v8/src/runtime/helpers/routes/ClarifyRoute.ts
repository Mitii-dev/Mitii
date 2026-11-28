import type { RouteBodyPlan } from "./types";

/** Clarify: no tools, no 3A, no verify — suspend for user answer. */
export function clarifyRouteBody(): RouteBodyPlan {
  return {
    route: "clarify",
    grantProfileHint: "none",
    runPlanPipeline: false,
    runEnrich: false,
    runTurnLoop: false,
    runVerify: false,
    exit: "suspend_clarify",
    reasonCodes: ["route_clarify"],
  };
}
