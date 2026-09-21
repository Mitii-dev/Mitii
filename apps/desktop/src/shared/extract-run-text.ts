/**
 * Extract assistant-visible text from Mitii RunEvent / AgentRunResult payloads.
 * Engine emits model_delta (preview), not raw LLM content_delta.
 *
 * model_delta.kind:
 * - content → answer stream (append preview chunks)
 * - reasoning → thinking timeline only (never answer)
 * - tool_call → tool name hints (never answer)
 */

const WORKING_SET_RE =
  /<working_set\b[^>]*>[\s\S]*?<\/working_set>/gi;

/** Strip engine scaffolding that Echo used to dump into the chat. */
export function sanitizeAssistantText(text: string): string {
  let out = text.replace(WORKING_SET_RE, '').trim();
  if (/^Echo:\s*/i.test(out)) {
    out = out.replace(/^Echo:\s*/i, '').trim();
  }
  if (!out || out.length < 3) {
    return '';
  }
  return out;
}

export function extractAssistantDelta(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  if (record.type === 'model_delta') {
    // Only content deltas belong in the answer body.
    if (record.kind !== 'content') return '';
    if (typeof record.preview === 'string' && record.preview.length > 0) {
      return record.preview;
    }
    return '';
  }
  if (
    record.type === 'content_delta' &&
    typeof record.content === 'string' &&
    record.content.length > 0
  ) {
    return record.content;
  }
  return '';
}

export function extractReasoningDelta(event: unknown): string {
  if (!event || typeof event !== 'object') return '';
  const record = event as Record<string, unknown>;
  if (
    record.type === 'model_delta' &&
    record.kind === 'reasoning' &&
    typeof record.preview === 'string'
  ) {
    return record.preview;
  }
  return '';
}

export function extractAssistantAnswer(result: unknown): string {
  if (!result || typeof result !== 'object') return '';
  const record = result as Record<string, unknown>;
  if (typeof record.answer === 'string' && record.answer.trim()) {
    return sanitizeAssistantText(record.answer);
  }
  return '';
}

export function extractRunStatus(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const status = (result as Record<string, unknown>).status;
  return typeof status === 'string' ? status : undefined;
}

export function extractRunError(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const error = (result as Record<string, unknown>).error;
  if (!error || typeof error !== 'object') return undefined;
  const message = (error as Record<string, unknown>).message;
  return typeof message === 'string' ? message : undefined;
}

export function extractRunId(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined;
  const runId = (result as Record<string, unknown>).runId;
  return typeof runId === 'string' && runId.trim() ? runId : undefined;
}
