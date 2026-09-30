import type { ToolInvocationInput } from "../../../contracts";
import type { SessionBudget } from "../../../internal/SessionBudget";
import type { ToolRegistry } from "../../../internal/ToolRegistry";
import type { CallClock, ToolExecuteOptions } from "../../types";
import { normalizeAndValidateArgs } from "./normalizeAndValidateArgs";
import { resolveRegistration } from "./resolveRegistration";
import { runAdversaryAndApproval } from "./adversaryAndApproval";
import type { PreflightOutcome } from "./types";
import { validateGrantStage } from "./validateGrantStage";

export type {
  PreflightFailure,
  PreflightOutcome,
  PreflightSuccess,
} from "./types";

/**
 * Budget, cancellation, registration, grant, approval, adversary, and argument checks.
 * Returns a rejected ToolResult when preflight fails.
 */
export async function preflightToolCall(params: {
  parsed: ToolInvocationInput;
  options: ToolExecuteOptions;
  budget: SessionBudget;
  registry: ToolRegistry;
  clock: CallClock;
}): Promise<PreflightOutcome> {
  const { parsed, options, budget, registry, clock } = params;

  const registration = await resolveRegistration({
    parsed,
    options,
    budget,
    registry,
    clock,
  });
  if (!registration.ok) {
    return registration;
  }

  const grantStage = validateGrantStage({
    parsed,
    options,
    registered: registration.registered,
    clock,
  });
  if (!grantStage.ok) {
    return grantStage;
  }

  const normalized = normalizeAndValidateArgs({
    parsed,
    options,
    registered: registration.registered,
    shadow: grantStage.shadow,
    clock,
  });
  if (!normalized.ok) {
    return normalized;
  }

  const fence = await runAdversaryAndApproval({
    parsed,
    options,
    registered: registration.registered,
    argumentsValue: normalized.argumentsValue,
    clock,
  });
  if (fence) {
    return fence;
  }

  const maxOutputBytes = Math.min(
    registration.registered.definition.maxOutputBytes,
    budget.remainingOutputBytes() ||
      registration.registered.definition.maxOutputBytes,
    parsed.grant.limits.maxOutputBytes,
  );

  return {
    ok: true,
    registered: registration.registered,
    maxOutputBytes,
    argumentsValue: normalized.argumentsValue,
  };
}
