import type { ToolGrant } from "../../contracts";
import type { AgentMode } from "../../../request-intake";
import type { ExecutionRoute } from "../../contracts";
import { clampGrantAgainstInjection } from "../../helpers/decisionSupport";

export function clampDecisionGrantAgainstInjection(params: {
  toolGrant: ToolGrant;
  injectionDetected: boolean;
  route: ExecutionRoute;
  mode: AgentMode;
}) {
  return clampGrantAgainstInjection(
    params.toolGrant,
    params.injectionDetected,
    params.route,
    params.mode,
  );
}
