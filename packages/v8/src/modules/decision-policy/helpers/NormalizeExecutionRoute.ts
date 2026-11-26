import {
  EXECUTION_ROUTE,
  LEGACY_ANSWER_ROUTES,
} from "../constants";
import type { ExecutionRoute } from "../contracts";

/**
 * Map legacy direct_answer / repository_answer → canonical `answer` (S2C merge).
 */
export function normalizeExecutionRoute(route: string): ExecutionRoute {
  if (
    (LEGACY_ANSWER_ROUTES as readonly string[]).includes(route) ||
    route === EXECUTION_ROUTE.ANSWER
  ) {
    return EXECUTION_ROUTE.ANSWER;
  }
  return route as ExecutionRoute;
}

/** True when route is answer or a legacy answer alias. */
export function isAnswerRoute(route: string): boolean {
  return (
    route === EXECUTION_ROUTE.ANSWER ||
    (LEGACY_ANSWER_ROUTES as readonly string[]).includes(route)
  );
}
