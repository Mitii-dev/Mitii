/** Prompt / resume streaming and assistant text extraction. */

import {
  extractAssistantAnswer,
  extractAssistantDelta,
  extractRunError,
  extractRunStatus,
  preserveStreamedAssistantAnswer,
} from '../../shared/extract-run-text.js';
import {
  type DesktopAgentMode,
  type DesktopPromptStreamLine,
} from '../../shared/protocol.js';
import {
  authHeaders,
  streamNdjson,
} from './http.js';

export async function* streamPrompt(options: {
  baseUrl: string;
  prompt: string;
  mode: DesktopAgentMode;
  token?: string;
  model?: string;
  sessionId?: string;
  approvalPreset?: string;
  thoroughness?: string;
  /** Database mode privilege (readonly | readwrite). */
  dbAccess?: 'readonly' | 'readwrite';
  pinnedPaths?: string[];
  requiredSkillIds?: string[];
  requiredMcpServerIds?: string[];
  /** Prior turns for Agent Engine (VS Code conversationCarry parity). */
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
  approvedPlan?: unknown;
  approvedPlanStrategy?: unknown;
  taskList?: unknown;
  completedPlanStepIds?: string[];
  signal?: AbortSignal;
}): AsyncGenerator<DesktopPromptStreamLine> {
  yield* streamNdjson(`${options.baseUrl}/v1/prompt`, {
    method: 'POST',
    headers: authHeaders(options.token),
    signal: options.signal,
    body: JSON.stringify({
      prompt: options.prompt,
      mode: options.mode,
      ...(options.model?.trim() ? { model: options.model.trim() } : {}),
      ...(options.sessionId?.trim()
        ? { sessionId: options.sessionId.trim() }
        : {}),
      ...(options.approvalPreset
        ? { approvalPreset: options.approvalPreset }
        : {}),
      ...(options.thoroughness ? { thoroughness: options.thoroughness } : {}),
      ...(options.dbAccess ? { dbAccess: options.dbAccess } : {}),
      ...(options.pinnedPaths?.length
        ? { pinnedPaths: options.pinnedPaths }
        : {}),
      ...(options.requiredSkillIds?.length
        ? { requiredSkillIds: options.requiredSkillIds }
        : {}),
      ...(options.requiredMcpServerIds?.length
        ? { requiredMcpServerIds: options.requiredMcpServerIds }
        : {}),
      ...(options.conversation && options.conversation.length > 0
        ? { conversation: options.conversation }
        : {}),
      ...(options.approvedPlan ? { approvedPlan: options.approvedPlan } : {}),
      ...(options.approvedPlanStrategy
        ? { approvedPlanStrategy: options.approvedPlanStrategy }
        : {}),
      ...(options.taskList ? { taskList: options.taskList } : {}),
      ...(options.completedPlanStepIds?.length
        ? { completedPlanStepIds: options.completedPlanStepIds }
        : {}),
    }),
  });
}

export async function* streamResume(options: {
  baseUrl: string;
  token?: string;
  mode?: DesktopAgentMode;
  body: Record<string, unknown>;
  signal?: AbortSignal;
}): AsyncGenerator<DesktopPromptStreamLine> {
  yield* streamNdjson(`${options.baseUrl}/v1/resume`, {
    method: 'POST',
    headers: authHeaders(options.token),
    signal: options.signal,
    body: JSON.stringify({
      ...options.body,
      ...(options.mode ? { mode: options.mode } : {}),
    }),
  });
}

/** Prefer streamed deltas; fall back to result.answer (previews are truncated). */
export function extractAssistantText(line: DesktopPromptStreamLine): string {
  if (line.op === 'event') return extractAssistantDelta(line.event);
  if (line.op === 'result') return extractAssistantAnswer(line.result);
  return '';
}

export function finalizeAssistantText(
  streamed: string,
  line: DesktopPromptStreamLine,
): string {
  if (line.op !== 'result') return streamed;
  const answer = extractAssistantAnswer(line.result);
  if (answer) {
    // Do not let a short final blocker erase streamed findings the user saw.
    return preserveStreamedAssistantAnswer(streamed, answer);
  }
  const status = extractRunStatus(line.result);
  const err = extractRunError(line.result);
  if (err) return streamed || `Run failed: ${err}`;
  if (status && status !== 'completed' && !streamed) {
    return `Run ended with status=${status}`;
  }
  return streamed;
}
