/**
 * Stage 4 — Emit Decision & Trace (S2C-FLOW).
 * Absorbs: resolve-context (flags only) + finalize.
 */

import type {
  DecisionPolicyInput,
  ExecutionDecision,
  ToolGrant,
} from "../../contracts";
import type { RoutePlanResult } from "../../helpers";
import { resolveDecisionContext } from "./6-resolve-context";
import { finalizeDecision } from "./7-finalize-decision";

export function emitDecisionAndTrace(params: {
  parsed: DecisionPolicyInput;
  mode: DecisionPolicyInput["envelope"]["mode"];
  routePlan: RoutePlanResult;
  toolGrant: ToolGrant;
  verification: ExecutionDecision["verification"];
  clampResult: { clamped: boolean };
  injection: { reasonCodes: readonly string[]; warnings: readonly string[] };
  safetyResult: { reasonCodes: readonly string[] };
  grantCompiledReasonCodes: readonly string[];
}): {
  decision: ExecutionDecision;
  contextReasonCodes: string[];
} {
  const { contextResult, hostCapabilityCodes, preflightBuild } =
    resolveDecisionContext({
      parsed: params.parsed,
      routePlan: params.routePlan,
      toolGrant: params.toolGrant,
    });

  const verification = normalizeVerification(params.verification);

  const decision = finalizeDecision({
    parsed: params.parsed,
    mode: params.mode,
    routePlan: params.routePlan,
    toolGrant: params.toolGrant,
    verification,
    clampResult: params.clampResult,
    injection: params.injection,
    safetyResult: params.safetyResult,
    contextResult,
    hostCapabilityCodes,
    preflightBuild,
    grantCompiledReasonCodes: params.grantCompiledReasonCodes,
  });

  return {
    decision,
    contextReasonCodes: [
      ...contextResult.reasonCodes,
      ...hostCapabilityCodes,
      ...preflightBuild.reasonCodes,
    ],
  };
}

function normalizeVerification(
  verification: ExecutionDecision["verification"],
): ExecutionDecision["verification"] {
  const checks =
    verification.checks && verification.checks.length > 0
      ? verification.checks
      : verification.minimumEvidence;
  return {
    ...verification,
    minimumEvidence: checks,
    checks,
    onFailure: verification.onFailure ?? "report",
  };
}
