import type { RouteBodyPlan } from "./types";

/** Answer: research grant, enrich + turn loop, skip 3A and verify. */
export function answerRouteBody(): RouteBodyPlan {
  return {
    route: "answer",
    grantProfileHint: "research",
    runPlanPipeline: false,
    runEnrich: true,
    runTurnLoop: true,
    runVerify: false,
    exit: "complete",
    reasonCodes: ["route_answer"],
  };
}
