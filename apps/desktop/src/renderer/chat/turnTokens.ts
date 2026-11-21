/** Per-turn token extraction and tool-completion helpers. */



export function extractTurnTokens(
  event: unknown,
): {
  in: number;
  out: number;
  cacheHit?: number;
  cacheMiss?: number;
} | null {
  if (!event || typeof event !== 'object') return null;
  const e = event as Record<string, unknown>;
  if (e.type !== 'model_turn') return null;
  const input = typeof e.inputTokens === 'number' ? e.inputTokens : 0;
  const output = typeof e.outputTokens === 'number' ? e.outputTokens : 0;
  return {
    in: input,
    out: output,
    ...(typeof e.cacheHitTokens === 'number'
      ? { cacheHit: e.cacheHitTokens }
      : {}),
    ...(typeof e.cacheMissTokens === 'number'
      ? { cacheMiss: e.cacheMissTokens }
      : {}),
  };
}

export function isToolCompleted(event: unknown): boolean {
  return Boolean(
    event &&
      typeof event === 'object' &&
      (event as Record<string, unknown>).type === 'tool_completed',
  );
}
