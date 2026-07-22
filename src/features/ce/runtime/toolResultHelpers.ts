import type { ToolResult } from '../../../kernel/tools/types';
import type { ToolExecutionResult } from '../safety/ToolExecutor';
import { isVerificationTool } from '../tools/toolMetadata';
import { isSkippedToolOutput } from './toolSkip';
import {
  isPassingVerificationEvidence,
  resolveVerificationEvidence,
} from './verificationEvidence';

export type ToolOutcome = Pick<ToolExecutionResult | ToolResult, 'success' | 'skipped' | 'output' | 'error'>;

/** Prefer typed skip flag; fall back to legacy output markers for older tool paths. */
export function isTypedToolSkip(result: ToolOutcome, outputText?: string): boolean {
  if (result.skipped) return true;
  const text = outputText ?? result.output ?? result.error ?? '';
  return isSkippedToolOutput(text);
}

/** A tool call that actually executed and succeeded — skips and dedup blocks do not count. */
export function countsAsToolSuccess(result: ToolOutcome, outputText?: string): boolean {
  if (isTypedToolSkip(result, outputText)) return false;
  return result.success;
}

/** Verification success requires passing structured verification evidence. */
export function countsAsVerificationSuccess(
  toolName: string,
  result: ToolOutcome,
  outputText?: string,
  input?: Record<string, unknown>
): boolean {
  if (!countsAsToolSuccess(result, outputText)) return false;
  const evidence = resolveVerificationEvidence(toolName, result, input, outputText);
  if (evidence) return isPassingVerificationEvidence(evidence);
  return isVerificationTool(toolName);
}
