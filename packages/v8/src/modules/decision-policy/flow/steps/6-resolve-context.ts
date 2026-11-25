import type { DecisionPolicyInput } from "../../contracts";
import type { RoutePlanResult } from "../../helpers";
import {
  resolveHostCapabilityReasonCodes,
  resolveRepositoryContextNeed,
} from "../../helpers/decisionSupport";
import { resolvePreflightBuild } from "../../helpers";

export function resolveDecisionContext(params: {
  parsed: DecisionPolicyInput;
  routePlan: RoutePlanResult;
  toolGrant: import("../../contracts").ToolGrant;
}) {
  const { parsed, routePlan, toolGrant } = params;
  const contextResult = resolveRepositoryContextNeed({
    route: routePlan.route,
    understanding: parsed.understanding,
    repositoryState: parsed.repositoryState,
  });
  const hostCapabilityCodes = resolveHostCapabilityReasonCodes(
    parsed.hostCapabilities,
  );
  const preflightBuild = resolvePreflightBuild({
    mode: parsed.envelope.mode,
    route: routePlan.route,
    understanding: parsed.understanding,
    grant: toolGrant,
  });
  return { contextResult, hostCapabilityCodes, preflightBuild };
}
