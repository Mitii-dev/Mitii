/**
 * Mitii Desktop wire contract (v1).
 *
 * Shared by the engine HTTP server, Electron preload, and renderer.
 * ACP-lite ops (ready / event / result / error) over HTTP + NDJSON.
 */

import { z } from 'zod';

import { parseWire, type WireParseResult } from '../parse.js';

export const MITII_DESKTOP_PROTOCOL = 'mitii-desktop/v1' as const;
export const MITII_DESKTOP_PROTOCOL_VERSION = 1 as const;

/** Optional field that falls back to `undefined` instead of failing the parse. */
const lenient = <T extends z.ZodTypeAny>(schema: T) =>
  schema.optional().catch(undefined);

const nonEmptyTrimmed = z
  .string()
  .transform((value) => value.trim())
  .pipe(z.string().min(1));

export const DesktopAgentModeSchema = z.enum([
  'ask',
  'plan',
  'agent',
  'database',
]);
export type DesktopAgentMode = z.infer<typeof DesktopAgentModeSchema>;

export const DesktopHostModeSchema = z.enum(['echo', 'host']);
export type DesktopHostMode = z.infer<typeof DesktopHostModeSchema>;

export function isDesktopAgentMode(value: unknown): value is DesktopAgentMode {
  return DesktopAgentModeSchema.safeParse(value).success;
}

/** GET /health */
export const DesktopHealthResponseSchema = z.object({
  ok: z.literal(true),
  protocol: z.literal(MITII_DESKTOP_PROTOCOL),
  version: z.literal(MITII_DESKTOP_PROTOCOL_VERSION),
  mode: DesktopHostModeSchema,
  workspaceRoot: z.string(),
});
export type DesktopHealthResponse = z.infer<typeof DesktopHealthResponseSchema>;

export const DesktopConversationTurnSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string(),
});
export type DesktopConversationTurn = z.infer<
  typeof DesktopConversationTurnSchema
>;

/** POST /v1/prompt body (normalized view the engine acts on first). */
export const DesktopPromptRequestSchema = z.object({
  id: z.string().optional(),
  prompt: z.string(),
  mode: DesktopAgentModeSchema.optional(),
  /** Optional override; when omitted the engine uses MITII_MODEL. */
  model: z.string().optional(),
  /** Chat thread id — used for VS Code–parity session JSONL filenames. */
  sessionId: z.string().optional(),
  /** Prior user/assistant turns for conversation carry. */
  conversation: z.array(DesktopConversationTurnSchema).optional(),
});
export type DesktopPromptRequest = z.infer<typeof DesktopPromptRequestSchema>;

const DesktopPromptBodySchema = z.object({
  prompt: z.string().transform((value) => value.trim()).pipe(z.string().min(1)),
  id: lenient(z.string().min(1)),
  mode: lenient(DesktopAgentModeSchema),
  model: lenient(nonEmptyTrimmed),
  sessionId: lenient(nonEmptyTrimmed),
});

export type DesktopPromptBodyError = 'expected_object' | 'prompt_required';

/** Validate + normalize POST /v1/prompt. Unknown or malformed optionals are dropped. */
export type DesktopPromptBody = Pick<DesktopPromptRequest, 'prompt'> &
  Partial<Pick<DesktopPromptRequest, 'id' | 'mode' | 'model' | 'sessionId'>>;

export function parseDesktopPromptBody(
  body: unknown,
): DesktopPromptBody | { error: DesktopPromptBodyError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'expected_object' };
  }
  const parsed = DesktopPromptBodySchema.safeParse(body);
  if (!parsed.success) return { error: 'prompt_required' };
  const { prompt, id, mode, model, sessionId } = parsed.data;
  return {
    prompt,
    ...(id ? { id } : {}),
    ...(mode ? { mode } : {}),
    ...(model ? { model } : {}),
    ...(sessionId ? { sessionId } : {}),
  };
}

/** POST /v1/resume body: at least one decision is required by the engine. */
export const DesktopResumeBodySchema = z.object({
  runId: z.string().transform((value) => value.trim()).pipe(z.string().min(1)),
  id: lenient(z.string()),
  mode: z
    .enum(['plan', 'agent'])
    .optional()
    .catch(undefined),
  sessionId: lenient(nonEmptyTrimmed),
  prompt: lenient(z.string()),
  approvalPreset: lenient(z.string()),
  clarificationAnswer: lenient(nonEmptyTrimmed),
  approval: lenient(
    z.object({
      approvalId: z.string().min(1),
      decision: z.enum(['approved', 'denied']),
    }),
  ),
  planDecision: lenient(
    z.object({ decision: z.enum(['approved', 'rejected', 'edited']) }),
  ),
  grantExpansion: lenient(
    z.object({
      expansionId: z.string().min(1),
      decision: z.enum(['approved', 'denied']),
    }),
  ),
  continueDecision: lenient(
    z.object({
      decision: z.enum(['continue', 'stop']),
      guidance: lenient(nonEmptyTrimmed),
    }),
  ),
});
export type DesktopResumeBody = z.infer<typeof DesktopResumeBodySchema>;

export type DesktopResumeBodyError = 'expected_object' | 'runId_required';

export function parseDesktopResumeBody(
  body: unknown,
): { ok: true; value: DesktopResumeBody } | { ok: false; error: DesktopResumeBodyError } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'expected_object' };
  }
  const parsed = DesktopResumeBodySchema.safeParse(body);
  if (!parsed.success) return { ok: false, error: 'runId_required' };
  return { ok: true, value: parsed.data };
}

/**
 * Run event envelope from the engine. The event vocabulary is owned by the
 * SDK; the wire contract only requires a string `type` discriminator and
 * preserves every other field.
 */
export interface DesktopRunEvent {
  type: string;
}
export const DesktopRunEventSchema: z.ZodType<
  DesktopRunEvent,
  z.ZodTypeDef,
  unknown
> = z.object({ type: z.string() }).passthrough();

/** Final run result envelope. The engine always sets a string `status`. */
export interface DesktopRunResult {
  status: string;
}
export const DesktopRunResultSchema: z.ZodType<
  DesktopRunResult,
  z.ZodTypeDef,
  unknown
> = z.object({ status: z.string() }).passthrough();

/** Host-synthesised Excalidraw / MCP Apps diagram event. */
export const DesktopMcpAppEventSchema = z.object({
  type: z.literal('mcp_app'),
  at: z.string(),
  detail: z.string().optional(),
  mcpApp: z.object({
    serverId: z.string(),
    tool: z.string(),
    title: z.string(),
    checkpointId: z.string().optional(),
    svgDataUrl: z.string().optional(),
    html: z.string().optional(),
    paths: z.object({
      md: z.string().optional(),
      docsMd: z.string().optional(),
      excalidraw: z.string().optional(),
      svg: z.string().optional(),
    }),
  }),
});
export type DesktopMcpAppEvent = z.infer<typeof DesktopMcpAppEventSchema>;

/** `model_delta` preview chunk (content | reasoning | tool_call). */
export const DesktopModelDeltaEventSchema = z
  .object({
    type: z.literal('model_delta'),
    kind: z.enum(['content', 'reasoning', 'tool_call']),
    preview: z.string().optional(),
  })
  .passthrough();
export type DesktopModelDeltaEvent = z.infer<
  typeof DesktopModelDeltaEventSchema
>;

/** Error envelope for non-2xx JSON and stream failures. */
export const DesktopErrorEnvelopeSchema = z.object({
  op: z.literal('error'),
  id: z.string().optional(),
  error: z.string(),
  message: z.string().optional(),
});
export type DesktopErrorEnvelope = z.infer<typeof DesktopErrorEnvelopeSchema>;

/** NDJSON stream lines from POST /v1/prompt and POST /v1/resume. */
export const DesktopPromptStreamLineSchema = z.discriminatedUnion('op', [
  z.object({
    op: z.literal('ready'),
    id: z.string(),
    mode: DesktopAgentModeSchema,
  }),
  z.object({
    op: z.literal('event'),
    id: z.string(),
    event: DesktopRunEventSchema,
  }),
  z.object({
    op: z.literal('result'),
    id: z.string(),
    result: DesktopRunResultSchema,
  }),
  DesktopErrorEnvelopeSchema,
]);
export type DesktopPromptStreamLine = z.infer<
  typeof DesktopPromptStreamLineSchema
>;

const STREAM_OPS: ReadonlySet<string> = new Set([
  'ready',
  'event',
  'result',
  'error',
]);

/** Parse one NDJSON text line from a prompt/resume stream. */
export function parseDesktopStreamLine(
  text: string,
): WireParseResult<DesktopPromptStreamLine> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return {
      ok: false,
      reason: 'invalid_shape',
      issues: [{ path: '', message: 'invalid_json' }],
    };
  }
  return parseWire(DesktopPromptStreamLineSchema, raw, {
    key: 'op',
    known: STREAM_OPS,
  });
}

/** NDJSON lines from POST /v1/ollama/pull. */
export const DesktopOllamaPullStreamLineSchema = z.union([
  z.object({ op: z.literal('start'), model: z.string() }),
  z.object({
    op: z.literal('progress'),
    status: z.string(),
    percent: z.number().optional(),
    total: z.number().optional(),
    completed: z.number().optional(),
  }),
  z.object({ op: z.literal('done'), ok: z.literal(true), model: z.string() }),
  z.object({ op: z.literal('done'), ok: z.literal(false), error: z.string() }),
]);
export type DesktopOllamaPullStreamLine = z.infer<
  typeof DesktopOllamaPullStreamLineSchema
>;

export function createPromptId(explicit?: string): string {
  if (explicit && explicit.length > 0) return explicit;
  return `prompt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
