import type { ToolInvocationInput } from "../../../contracts";
import type { RegisteredTool } from "../../../internal/ToolRegistry";
import type { ShadowGrantAuthorizer } from "../../../internal/shadow/ShadowGrantAuthorizer";
import type { ToolExecuteOptions } from "../../types";

export function runShadowAuthorize(params: {
  authorizer: ShadowGrantAuthorizer;
  tool: RegisteredTool["definition"];
  grant: ToolInvocationInput["grant"];
  arguments: unknown;
  primaryAllowed: boolean;
  onShadowAuthorize?: ToolExecuteOptions["onShadowAuthorize"];
}) {
  const shadow = params.authorizer.authorize({
    tool: params.tool,
    grant: params.grant,
    arguments: params.arguments,
  });
  const disagreed =
    (params.primaryAllowed && shadow.decision === "Deny") ||
    (!params.primaryAllowed && shadow.decision === "Allow");
  params.onShadowAuthorize?.({
    toolName: params.tool.name,
    primaryAllowed: params.primaryAllowed,
    shadow,
    disagreed,
  });
  return shadow;
}
