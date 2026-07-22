import { classifyCommandEffect } from '../plans/PlanActEngine';
import { ToolId } from '../tools/toolIds';
import { isVerificationTool } from '../tools/toolMetadata';
import { isSkippedToolOutput } from './toolSkip';

export type VerificationEvidenceStatus = 'passed' | 'failed' | 'inconclusive';

export interface VerificationEvidence {
  kind: 'verification-result';
  toolId: string;
  status: VerificationEvidenceStatus;
  target?: string;
  executedAt: number;
}

type ToolOutcome = { success: boolean; skipped?: boolean; output?: string; error?: string };

function isSkipped(result: ToolOutcome, outputText?: string): boolean {
  if (result.skipped) return true;
  const text = outputText ?? result.output ?? result.error ?? '';
  return isSkippedToolOutput(text);
}

function commandFromInput(input?: Record<string, unknown>): string | undefined {
  if (typeof input?.command === 'string') return input.command;
  if (typeof input?.script === 'string') return input.script;
  return undefined;
}

/**
 * Derive structured verification evidence from a tool outcome.
 * Non-verification commands (pwd, git status) produce inconclusive evidence even on success.
 */
export function resolveVerificationEvidence(
  toolName: string,
  result: ToolOutcome,
  input?: Record<string, unknown>,
  outputText?: string
): VerificationEvidence | undefined {
  if (!isVerificationTool(toolName)) return undefined;
  if (isSkipped(result, outputText)) return undefined;

  const executedAt = Date.now();
  const target = commandFromInput(input);

  if (toolName === ToolId.Diagnostics) {
    return {
      kind: 'verification-result',
      toolId: toolName,
      status: result.success ? 'passed' : 'failed',
      executedAt,
    };
  }

  if (toolName === ToolId.RunCommand || toolName === ToolId.ExecuteWorkspaceScript) {
    if (!target) {
      return {
        kind: 'verification-result',
        toolId: toolName,
        status: 'inconclusive',
        executedAt,
      };
    }

    const effect = classifyCommandEffect(target);
    if (effect !== 'verification_with_artifacts') {
      return {
        kind: 'verification-result',
        toolId: toolName,
        status: 'inconclusive',
        target,
        executedAt,
      };
    }

    return {
      kind: 'verification-result',
      toolId: toolName,
      status: result.success ? 'passed' : 'failed',
      target,
      executedAt,
    };
  }

  return undefined;
}

export function isPassingVerificationEvidence(
  evidence: VerificationEvidence | undefined
): boolean {
  return evidence?.status === 'passed';
}
