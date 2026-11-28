import { isContinuationTurnKind } from "../../../request-understanding";
import {
  DECISION_POLICY_SCHEMA_VERSION,
  DECISION_REASON,
} from "../../constants";
import { executionDecisionSchema } from "../../contracts";
import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../contracts";
import type { RoutePlanResult } from "../../helpers";
import {
  buildDecisionTrace,
  buildRationale,
  uniqueReasonCodes,
} from "../../helpers/decisionSupport";

export function finalizeDecision(params: {
  parsed: DecisionPolicyInput;
  mode: DecisionPolicyInput["envelope"]["mode"];
  routePlan: RoutePlanResult;
  toolGrant: ToolGrant;
  verification: ExecutionDecision["verification"];
  clampResult: { clamped: boolean };
  injection: { reasonCodes: readonly string[]; warnings: readonly string[] };
  safetyResult: { reasonCodes: readonly string[] };
  contextResult: {
    reasonCodes: readonly string[];
    warnings: readonly string[];
    repositoryContextRequired: boolean;
    pinnedState?: ExecutionDecision["pinnedState"];
  };
  hostCapabilityCodes: readonly string[];
  preflightBuild: { reasonCodes: readonly string[] };
  grantCompiledReasonCodes: readonly string[];
}): ExecutionDecision {
  const {
    parsed,
    mode,
    routePlan,
    toolGrant,
    verification,
    clampResult,
    injection,
    safetyResult,
    contextResult,
    hostCapabilityCodes,
    preflightBuild,
    grantCompiledReasonCodes,
  } = params;

  const reasonCodes = uniqueReasonCodes([
    ...routePlan.reasonCodes,
    ...grantCompiledReasonCodes,
    ...contextResult.reasonCodes,
    ...hostCapabilityCodes,
    ...preflightBuild.reasonCodes,
    ...injection.reasonCodes,
    ...safetyResult.reasonCodes,
    ...(isContinuationTurnKind(parsed.envelope.turnKind)
      ? ([DECISION_REASON.turnContinuation] as const)
      : []),
  ]);

  const trace = buildDecisionTrace({
    reasonCodes,
    grant: toolGrant,
    clampedByInjection: clampResult.clamped,
    understanding: parsed.understanding,
  });

  return executionDecisionSchema.parse({
    schemaVersion: DECISION_POLICY_SCHEMA_VERSION,
    route: routePlan.route,
    planningDepth: routePlan.planningDepth,
    planGate: routePlan.planGate,
    runDisposition: routePlan.runDisposition,
    repositoryContextRequired: contextResult.repositoryContextRequired,
    pinnedState: contextResult.pinnedState,
    toolGrant,
    verification,
    reasonCodes,
    rationale: buildRationale({
      route: routePlan.route,
      planningDepth: routePlan.planningDepth,
      planGate: routePlan.planGate,
      mode,
      reasonCodes,
    }),
    warnings: [...injection.warnings, ...contextResult.warnings],
    trace,
  });
}
