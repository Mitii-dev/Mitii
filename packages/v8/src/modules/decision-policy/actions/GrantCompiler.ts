import type { RequestUnderstandingResult } from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";

import type {
  ApprovalMode,
  DecisionReasonCode,
  ExecutionRoute,
  ToolGrant,
} from "../contracts";
import { buildToolGrant } from "./BuildToolGrant";
import { resolveVerificationRequirement } from "./ResolveVerificationRequirement";

export interface CompiledGrantResult {
  toolGrant: ToolGrant;
  verification: ReturnType<
    typeof resolveVerificationRequirement
  >["verification"];
  reasonCodes: DecisionReasonCode[];
}

/**
 * GrantCompiler: route + risk + host caps → ToolGrant + verification requirement.
 * Does not choose the execution route.
 */
export function compileGrant(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  understanding: RequestUnderstandingResult;
  message?: string;
  approvalMode?: ApprovalMode;
  allowWebSearch?: boolean;
  windowPolicy?: WindowPolicy;
}): CompiledGrantResult {
  const grantResult = buildToolGrant({
    mode: params.mode,
    route: params.route,
    understanding: params.understanding,
    message: params.message,
    approvalMode: params.approvalMode,
    allowWebSearch: params.allowWebSearch === true,
    windowPolicy: params.windowPolicy,
  });
  const verificationResult = resolveVerificationRequirement({
    route: params.route,
    mode: params.mode,
    understanding: params.understanding,
    maximumWorkspaceEffect: grantResult.toolGrant.maximumWorkspaceEffect,
  });

  return {
    toolGrant: grantResult.toolGrant,
    verification: verificationResult.verification,
    reasonCodes: [
      ...grantResult.reasonCodes,
      ...verificationResult.reasonCodes,
    ],
  };
}
