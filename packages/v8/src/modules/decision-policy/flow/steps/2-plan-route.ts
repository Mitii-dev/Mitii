import type { DecisionPolicyInput } from "../../contracts";
import { planRoute } from "../../helpers";

export function planDecisionRoute(params: {
  parsed: DecisionPolicyInput;
  message: string;
}) {
  const { parsed, message } = params;
  return planRoute({
    mode: parsed.envelope.mode,
    understanding: parsed.understanding,
    message,
    planApproval: parsed.planApproval,
    windowPolicy: parsed.windowPolicy,
    origin: parsed.envelope.origin,
    policyFactsFirst: parsed.policyFactsFirst,
    turnKind: parsed.envelope.turnKind,
    requiredMcpServerIds: parsed.requiredMcpServerIds,
  });
}
