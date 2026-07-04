export type MitiiMode = 'ask' | 'plan' | 'agent' | 'review';
export type MitiiApprovalMode = 'auto' | 'manual';
export type MitiiRuntime = 'real' | 'stub';

export interface MitiiClientOptions {
  cwd: string;
  packageRoot?: string;
  runtime?: MitiiRuntime;
  provider?: string;
  providerType?: string;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  approval?: MitiiApprovalMode;
  allowNetwork?: boolean;
  enablePuppeteer?: boolean;
  vectors?: boolean;
  indexWorkspace?: boolean;
}

export interface MitiiQueryOptions extends MitiiClientOptions {
  mode?: MitiiMode;
  prompt: string;
  sessionId?: string;
  signal?: AbortSignal;
}

export type MitiiApprovalDecision = 'approved' | 'denied';

export type MitiiEvent =
  | { type: 'session_start'; sessionId: string; mode: string; cwd: string; data?: Record<string, unknown> }
  | { type: 'assistant_delta'; content: string }
  | { type: 'reasoning_delta'; content: string }
  | { type: 'tool_start'; tool: string; input?: Record<string, unknown>; id?: string; message?: string }
  | { type: 'tool_end'; tool: string; success: boolean; output?: string; error?: string; durationMs?: number; id?: string }
  | { type: 'approval_required'; id: string; tool: string; input?: Record<string, unknown>; message?: string }
  | { type: 'approval_resolved'; id?: string; tool?: string; decision?: MitiiApprovalDecision | string }
  | { type: 'plan'; plan: Record<string, unknown> }
  | { type: 'metrics'; durationMs: number; toolCalls: number; sessionLogPath?: string; auditTools?: string[] }
  | { type: 'error'; message: string; data?: Record<string, unknown> }
  | { type: 'done'; content: string; metrics?: Record<string, unknown> }
  | { type: 'log'; event: Record<string, unknown> };

export interface MitiiResult {
  content: string;
  events: MitiiEvent[];
}
