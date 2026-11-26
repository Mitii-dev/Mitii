import { answerRouteBody } from "./AnswerRoute";
import { clarifyRouteBody } from "./ClarifyRoute";
import { diagnoseRouteBody } from "./DiagnoseRoute";
import { executeRouteBody } from "./ExecuteRoute";
import { planRouteBody } from "./PlanRoute";
import type { RouteBodyPlan } from "./types";

/** Pick the job-card body from wire route + plan knobs. Routes never call each other. */
export function selectRouteBody(params: {
  route: string;
  planningDepth?: string;
  planGate?: string;
}): RouteBodyPlan {
  const route =
    params.route === "repository_answer" || params.route === "direct_answer"
      ? "answer"
      : params.route;

  switch (route) {
    case "clarify":
      return clarifyRouteBody();
    case "answer":
      return answerRouteBody();
    case "diagnose":
      return diagnoseRouteBody();
    case "plan":
      return planRouteBody();
    case "execute":
      return executeRouteBody({
        planningDepth: params.planningDepth ?? "none",
        planGate: params.planGate ?? "none",
      });
    default:
      return answerRouteBody();
  }
}
