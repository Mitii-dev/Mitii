/**
 * Mitii Desktop wire contract (v1).
 *
 * Shared by engine HTTP, Electron preload, and renderer.
 * ACP-lite ops (ping/prompt/event/result) over HTTP + NDJSON.
 * Decision Policy remains authority; V8 does not import this.
 */

export const MITII_DESKTOP_PROTOCOL = 'mitii-desktop/v1' as const;
export const MITII_DESKTOP_PROTOCOL_VERSION = 1 as const;

export type DesktopAgentMode = 'ask' | 'plan' | 'agent';

export type DesktopHostMode = 'echo' | 'host';

/** GET /health */
export interface DesktopHealthResponse {
  ok: true;
  protocol: typeof MITII_DESKTOP_PROTOCOL;
  version: typeof MITII_DESKTOP_PROTOCOL_VERSION;
  mode: DesktopHostMode;
  workspaceRoot: string;
}

/** POST /v1/prompt body */
export interface DesktopPromptRequest {
  id?: string;
  prompt: string;
  mode?: DesktopAgentMode;
  /** Optional override; when omitted the engine uses MITII_MODEL. */
  model?: string;
  /** Chat thread id — used for VS Code–parity session JSONL filenames. */
  sessionId?: string;
  /** Prior user/assistant turns for conversation carry. */
  conversation?: Array<{ role: 'user' | 'assistant'; content: string }>;
}

/** NDJSON stream lines from POST /v1/prompt */
export type DesktopPromptStreamLine =
  | { op: 'ready'; id: string; mode: DesktopAgentMode }
  | { op: 'event'; id: string; event: unknown }
  | { op: 'result'; id: string; result: unknown }
  | { op: 'error'; id?: string; error: string; message?: string };

export function isDesktopAgentMode(value: unknown): value is DesktopAgentMode {
  return value === 'ask' || value === 'plan' || value === 'agent';
}

export function parseDesktopPromptBody(
  body: unknown,
): DesktopPromptRequest | { error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'expected_object' };
  }
  const record = body as Record<string, unknown>;
  const prompt = typeof record.prompt === 'string' ? record.prompt.trim() : '';
  if (!prompt) return { error: 'prompt_required' };
  const id = typeof record.id === 'string' && record.id.length > 0 ? record.id : undefined;
  const mode = isDesktopAgentMode(record.mode) ? record.mode : undefined;
  const model =
    typeof record.model === 'string' && record.model.trim()
      ? record.model.trim()
      : undefined;
  const sessionId =
    typeof record.sessionId === 'string' && record.sessionId.trim()
      ? record.sessionId.trim()
      : undefined;
  return {
    prompt,
    ...(id ? { id } : {}),
    ...(mode ? { mode } : {}),
    ...(model ? { model } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

export function createPromptId(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  return `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
