import type { HeadlessPlan } from './AgentRunner';
import type { SessionLogEvent } from '../telemetry/SessionLogService';

export type MitiiMode = 'ask' | 'plan' | 'agent' | 'review';

export type MitiiApprovalDecision = 'approved' | 'denied';

export interface MitiiMetrics {
  durationMs: number;
  toolCalls: number;
  errors?: string[];
  sessionLogPath?: string;
  auditTools?: string[];
}

export type MitiiEvent =
  | { type: 'session_start'; sessionId: string; mode: string; cwd: string; data?: Record<string, unknown> }
  | { type: 'assistant_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_start'; tool: string; input?: Record<string, unknown>; id?: string; message?: string }
  | { type: 'tool_end'; tool: string; success: boolean; output?: string; error?: string; durationMs?: number; id?: string }
  | { type: 'approval_required'; id: string; tool: string; input?: Record<string, unknown>; message?: string }
  | { type: 'approval_resolved'; id?: string; tool?: string; decision?: MitiiApprovalDecision | string }
  | { type: 'plan'; plan: HeadlessPlan | Record<string, unknown> }
  | { type: 'metrics'; durationMs: number; toolCalls: number; sessionLogPath?: string; auditTools?: string[] }
  | { type: 'error'; message: string; data?: Record<string, unknown> }
  | { type: 'done'; content: string; metrics?: MitiiMetrics }
  | { type: 'log'; event: SessionLogEvent };

export function eventFromSessionLog(event: SessionLogEvent, cwd = '', mode = ''): MitiiEvent {
  const data = event.data ?? {};
  if (event.type === 'session_start') {
    return {
      type: 'session_start',
      sessionId: event.sessionId,
      mode: String(data.mode ?? mode),
      cwd: String(data.workspace ?? cwd),
      data,
    };
  }
  if (event.type === 'tool_start') {
    return {
      type: 'tool_start',
      tool: String(data.toolName ?? data.tool ?? event.message),
      id: stringValue(data.toolCallId),
      input: compactInput(data),
      message: event.message,
    };
  }
  if (event.type === 'tool_end') {
    return {
      type: 'tool_end',
      tool: String(data.toolName ?? data.tool ?? event.message),
      id: stringValue(data.toolCallId),
      success: data.success !== false,
      output: stringValue(data.outputPreview),
      error: stringValue(data.error),
      durationMs: numberValue(data.durationMs),
    };
  }
  if (event.type === 'approval_request') {
    return {
      type: 'approval_required',
      id: String(data.id ?? ''),
      tool: String(data.toolName ?? data.tool ?? event.message),
      input: compactInput(data),
      message: event.message,
    };
  }
  if (event.type === 'approval_decision') {
    return {
      type: 'approval_resolved',
      id: stringValue(data.id),
      tool: stringValue(data.toolName ?? data.tool),
      decision: stringValue(data.decision ?? event.message.split(':')[0]),
    };
  }
  if (event.type === 'plan_created') {
    return { type: 'plan', plan: data };
  }
  if (event.type === 'turn_complete' || event.type === 'token_usage' || event.type === 'timing') {
    return { type: 'log', event };
  }
  if (event.type === 'error') {
    return { type: 'error', message: event.message, data };
  }
  return { type: 'log', event };
}

function compactInput(data: Record<string, unknown>): Record<string, unknown> | undefined {
  const input: Record<string, unknown> = {};
  for (const key of ['path', 'command', 'inputPreview', 'risk', 'reason', 'files', 'question', 'optionCount']) {
    if (data[key] !== undefined) input[key] = data[key];
  }
  return Object.keys(input).length > 0 ? input : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
