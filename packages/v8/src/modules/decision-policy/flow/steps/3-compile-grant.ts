import type { DecisionPolicyInput } from "../../contracts";
import type { RoutePlanResult } from "../../helpers";
import { compileGrant } from "../../helpers";

export function compileDecisionGrant(params: {
  parsed: DecisionPolicyInput;
  message: string;
  routePlan: RoutePlanResult;
}) {
  const { parsed, message, routePlan } = params;
  return compileGrant({
    mode: parsed.envelope.mode,
    route: routePlan.route,
    understanding: parsed.understanding,
    message,
    approvalMode: parsed.approvalMode,
    allowWebSearch: parsed.hostCapabilities?.webSearch === true,
    windowPolicy: parsed.windowPolicy,
    requiredMcpServerIds: parsed.requiredMcpServerIds,
  });
}
