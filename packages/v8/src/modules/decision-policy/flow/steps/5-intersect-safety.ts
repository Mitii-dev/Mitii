import type { DecisionPolicyInput, ToolGrant } from "../../contracts";
import { intersectUserSafetyRules } from "../../helpers";

export function intersectDecisionSafety(params: {
  toolGrant: ToolGrant;
  userSafetyRules: DecisionPolicyInput["userSafetyRules"];
}) {
  return intersectUserSafetyRules(
    params.toolGrant,
    params.userSafetyRules,
  );
}
