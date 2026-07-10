/** Runtime health of an optional/degradable subsystem (embeddings, vector backend, …).
 * Distinct from static config description: this reflects what actually happened at runtime,
 * not just what was requested/available at startup. */
export interface ComponentHealth {
  status: 'unknown' | 'ready' | 'degraded';
  detail?: string;
}

export const UNKNOWN_HEALTH: ComponentHealth = { status: 'unknown' };

/** Native-loader errors (dlopen, etc.) dump multi-clause traces with local filesystem paths —
 * fine for logs, not for a settings UI. Keep only the leading reason, capped in length. */
export function summarizeHealthDetail(error: unknown, maxLen = 160): string {
  const message = error instanceof Error ? error.message : String(error);
  const firstLine = message.split('\n')[0].trim();
  return firstLine.length > maxLen ? `${firstLine.slice(0, maxLen - 1)}…` : firstLine;
}
