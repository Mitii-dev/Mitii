import type {
  RequestTurnKind,
  UserRequestOrigin,
} from "../../request-intake";
import type {
  EndingPosture,
  RequestUnderstandingResult,
} from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  PlanningDepth,
  PlanGate,
} from "../contracts";
import { resolvePlanGate } from "./ResolvePlanGate";
import { resolvePlanningDepth } from "./ResolvePlanningDepth";
import { resolveRoute, type RouteResolution } from "./ResolveRoute";
import { EXECUTION_ROUTE } from "../constants";

export interface RoutePlanResult {
  route: ExecutionRoute;
  runDisposition: "continue" | "clarification_required";
  planningDepth: PlanningDepth;
  planGate: PlanGate;
  reasonCodes: DecisionReasonCode[];
}

function isUnattendedOrigin(origin: UserRequestOrigin | undefined): boolean {
  return origin === "automation" || origin === "api";
}

/**
 * Explicit MCP attach (Database mode / `@mcp:` pins) means the user expects
 * live tools this turn. Stamp reason codes; route is already canonical answer.
 */
function groundRouteForMcpAttach(
  routeResult: RouteResolution,
  requiredMcpServerIds: readonly string[] | undefined,
): RouteResolution {
  if (!requiredMcpServerIds || requiredMcpServerIds.length === 0) {
    return routeResult;
  }
  if (
    routeResult.route !== EXECUTION_ROUTE.ANSWER &&
    routeResult.route !== EXECUTION_ROUTE.DIRECT_ANSWER
  ) {
    return routeResult;
  }
  return {
    route: EXECUTION_ROUTE.ANSWER,
    runDisposition: "continue",
    reasonCodes: [
      ...routeResult.reasonCodes,
      "mcp_attach_required",
      "repository_grounded_answer",
    ],
  };
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
  windowPolicy?: WindowPolicy;
  /** When automation/api, suppress interactive clarify and continue best-effort. */
  origin?: UserRequestOrigin;
  /**
   * Prefer high-confidence understanding over looksLike* heuristics.
   * Default on when omitted; pass false to force the classic heuristic path.
   */
  policyFactsFirst?: boolean;
  /** Intake turn kind — continuation prefers ballot over soft re-clarify. */
  turnKind?: RequestTurnKind;
  priorRoute?: string;
  endingPosture?: EndingPosture;
  /**
   * When non-empty, stamp MCP attach on answer so research grant stays tool-live.
   */
  requiredMcpServerIds?: readonly string[];
}): RoutePlanResult {
  const unattended = isUnattendedOrigin(params.origin);
  let routeResult = resolveRoute({
    mode: params.mode,
    understanding: params.understanding,
    message: params.message,
    policyFactsFirst: params.policyFactsFirst,
    turnKind: params.turnKind,
    priorRoute: params.priorRoute,
    endingPosture: params.endingPosture,
  });
  const originReasonCodes: DecisionReasonCode[] = [];
  if (params.origin === "automation") {
    originReasonCodes.push("automation_origin");
  } else if (params.origin === "api") {
    originReasonCodes.push("api_origin");
  }
  if (unattended && routeResult.route === EXECUTION_ROUTE.CLARIFY) {
    routeResult = resolveRoute({
      mode: params.mode,
      understanding: params.understanding,
      message: params.message,
      suppressClarification: true,
      policyFactsFirst: params.policyFactsFirst,
      turnKind: params.turnKind,
      priorRoute: params.priorRoute,
      endingPosture: params.endingPosture,
    });
    originReasonCodes.push("automation_clarify_suppressed");
  }
  routeResult = groundRouteForMcpAttach(routeResult, params.requiredMcpServerIds);
  const depthResult = resolvePlanningDepth({
    mode: params.mode,
    route: routeResult.route,
    understanding: params.understanding,
    message: params.message,
    windowPolicy: params.windowPolicy,
  });
  const resolvedPlanGate = resolvePlanGate({
    mode: params.mode,
    route: routeResult.route,
    planningDepth: depthResult.planningDepth,
    understanding: params.understanding,
  });
  const planGateResult =
    params.planApproval === "never"
      ? {
          planGate: "none" as const,
          reasonCodes:
            resolvedPlanGate.planGate === "required_before_execute"
              ? // Host policy suppressed a gate risk analysis required — keep
                // that fact visible instead of silently replacing it with
                // "plan_gate_none", which looks identical to "never needed one".
                ([
                  "plan_gate_none",
                  "plan_gate_suppressed_by_policy",
                ] as const)
              : (["plan_gate_none"] as const),
        }
      : resolvedPlanGate;

  return {
    route: routeResult.route,
    runDisposition: routeResult.runDisposition,
    planningDepth: depthResult.planningDepth,
    planGate: planGateResult.planGate,
    reasonCodes: [
      ...originReasonCodes,
      ...routeResult.reasonCodes,
      ...depthResult.reasonCodes,
      ...planGateResult.reasonCodes,
    ],
  };
}
