import type { ThunderPlan } from '../plans/PlanActEngine';
import { classifyCommandEffect, resolveStepPhaseLock, stepImpliesWrite } from '../plans/PlanActEngine';
import { WRITE_TOOL_IDS } from '../tools/toolMetadata';
import { countsAsVerificationSuccess } from './toolResultHelpers';

export interface StepCompletionCounters {
  successfulWrites: number;
  successfulVerifyCommands: number;
  failedVerifyCommands: number;
  toolCallCount: number;
  toolCallSuccessCount: number;
  writeExpected: boolean;
  isVerifyStep: boolean;
  explicitToolName?: string;
  explicitToolSucceeded?: boolean;
}

export interface StepCompletionDecision {
  complete: boolean;
  missing: string[];
}

export function isPlanVerifyStep(
  step: { title: string; phase?: string },
  phaseLock?: string
): boolean {
  if (step.phase === 'diagnostics' || step.phase === 'review') return false;
  return phaseLock === 'verify' || /\b(verify|verification|lint|build|validate|test)\b/i.test(step.title);
}

export function buildStepCompletionCounters(
  step: ThunderPlan['steps'][number],
  mode: string,
  snapshot: PlanStepToolSnapshot
): StepCompletionCounters {
  const phaseLock = resolveStepPhaseLock(step, mode);
  const explicitToolCall = step.tool ? { name: step.tool } : undefined;
  const isVerifyStep = isPlanVerifyStep(step, phaseLock);
  const writeExpected =
    stepImpliesWrite(step) && mode === 'agent' && !explicitToolCall && !isVerifyStep;

  return {
    successfulWrites: snapshot.successfulWrites,
    successfulVerifyCommands: snapshot.successfulVerifyCommands,
    failedVerifyCommands: snapshot.failedVerifyCommands,
    toolCallCount: snapshot.toolCallCount,
    toolCallSuccessCount: snapshot.toolCallSuccessCount,
    writeExpected,
    isVerifyStep,
    explicitToolName: explicitToolCall?.name,
    explicitToolSucceeded: explicitToolCall
      ? snapshot.successfulExplicitTools.has(explicitToolCall.name)
      : undefined,
  };
}

export function evaluateStepCompletion(counters: StepCompletionCounters): StepCompletionDecision {
  const missing: string[] = [];

  if (counters.writeExpected && counters.successfulWrites === 0) {
    missing.push('This step requires successful file edits (write_file/apply_patch).');
  }

  if (counters.isVerifyStep && counters.failedVerifyCommands > 0) {
    missing.push(
      `Verification commands failed ${counters.failedVerifyCommands} time(s). Fix reported errors before completing this step.`
    );
  }

  if (counters.isVerifyStep && counters.successfulVerifyCommands === 0) {
    missing.push(
      'This verification step requires a successful diagnostics, typecheck, lint, test, or build command. Captured failing diagnostics alone do not satisfy verification.'
    );
  }

  if (counters.explicitToolName && counters.explicitToolSucceeded !== true) {
    missing.push(`Required tool ${counters.explicitToolName} must succeed before this step can complete.`);
  }

  const isGenericStep =
    !counters.writeExpected &&
    !counters.isVerifyStep &&
    !counters.explicitToolName;
  if (isGenericStep && counters.toolCallCount > 0 && counters.toolCallSuccessCount === 0) {
    missing.push('At least one tool call in this step must succeed before completion.');
  }

  return { complete: missing.length === 0, missing };
}

export interface PlanStepToolSnapshot {
  stepId?: string;
  successfulWrites: number;
  successfulVerifyCommands: number;
  failedVerifyCommands: number;
  toolCallCount: number;
  toolCallSuccessCount: number;
  successfulExplicitTools: Set<string>;
}

export function emptyPlanStepToolSnapshot(): PlanStepToolSnapshot {
  return {
    successfulWrites: 0,
    successfulVerifyCommands: 0,
    failedVerifyCommands: 0,
    toolCallCount: 0,
    toolCallSuccessCount: 0,
    successfulExplicitTools: new Set<string>(),
  };
}

export function recordPlanStepToolOutcome(
  snapshot: PlanStepToolSnapshot,
  toolName: string,
  result: { success: boolean; output?: string; error?: string; skipped?: boolean },
  input?: Record<string, unknown>,
  outputText?: string
): PlanStepToolSnapshot {
  const next = {
    ...snapshot,
    successfulExplicitTools: new Set(snapshot.successfulExplicitTools),
  };
  next.toolCallCount += 1;

  const output = outputText ?? result.output ?? result.error ?? '';
  if (result.skipped || /^\[SKIPPED:/.test(output)) {
    return next;
  }

  if (!result.success) {
    if (toolName === 'run_command' && typeof input?.command === 'string') {
      if (classifyCommandEffect(input.command) === 'verification_with_artifacts') {
        next.failedVerifyCommands += 1;
      }
    }
    return next;
  }

  next.toolCallSuccessCount += 1;
  if (WRITE_TOOL_IDS.has(toolName)) {
    next.successfulWrites += 1;
  }
  if (countsAsVerificationSuccess(toolName, { success: true, output }, output, input)) {
    next.successfulVerifyCommands += 1;
  }
  next.successfulExplicitTools.add(toolName);
  return next;
}
