/**
 * Stage 3 — Compile Grant & Fences (S2C-FLOW).
 * Absorbs: compile-grant + clamp-injection + intersect-safety + unified scopes.
 */

import type { DecisionPolicyInput, ToolGrant } from "../../contracts";
import { attachUnifiedScopes } from "../../helpers/AttachUnifiedScopes";
import type { RoutePlanResult } from "../../helpers";
import { compileDecisionGrant } from "./3-compile-grant";
import { clampDecisionGrantAgainstInjection } from "./4-clamp-injection";
import { intersectDecisionSafety } from "./5-intersect-safety";

export function compileGrantAndFences(params: {
  parsed: DecisionPolicyInput;
  message: string;
  routePlan: RoutePlanResult;
  injectionDetected: boolean;
  mode: DecisionPolicyInput["envelope"]["mode"];
}): {
  toolGrant: ToolGrant;
  verification: ReturnType<typeof compileDecisionGrant>["verification"];
  grantCompiledReasonCodes: readonly string[];
  clampResult: { clamped: boolean; toolGrant: ToolGrant };
  safetyResult: { toolGrant: ToolGrant; reasonCodes: readonly string[] };
  reasonCodes: string[];
} {
  const grantCompiled = compileDecisionGrant({
    parsed: params.parsed,
    message: params.message,
    routePlan: params.routePlan,
  });

  const clampResult = clampDecisionGrantAgainstInjection({
    toolGrant: grantCompiled.toolGrant,
    injectionDetected: params.injectionDetected,
    route: params.routePlan.route,
    mode: params.mode,
  });

  const safetyResult = intersectDecisionSafety({
    toolGrant: clampResult.toolGrant,
    userSafetyRules: params.parsed.userSafetyRules,
  });

  const toolGrant = attachUnifiedScopes(safetyResult.toolGrant);

  return {
    toolGrant,
    verification: grantCompiled.verification,
    grantCompiledReasonCodes: grantCompiled.reasonCodes,
    clampResult: {
      ...clampResult,
      toolGrant: attachUnifiedScopes(clampResult.toolGrant),
    },
    safetyResult: {
      ...safetyResult,
      toolGrant,
    },
    reasonCodes: [...grantCompiled.reasonCodes, ...safetyResult.reasonCodes],
  };
}
