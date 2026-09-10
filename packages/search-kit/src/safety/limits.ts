/** Shared retrieval limits (enterprise defaults). */

export const DEFAULT_SEARCH_TIMEOUT_MS = 12_000;
export const DEFAULT_CONTENT_TIMEOUT_MS = 15_000;
export const DEFAULT_MAX_SEARCH_RESULTS = 5;
export const DEFAULT_MAX_CONTENT_BYTES = 512_000;
export const DEFAULT_MAX_MARKDOWN_CHARS = 48_000;
export const MAX_PROVIDER_CHAIN = 5;
export const MAX_REDIRECTS = 3;

export function clampResults(n: number, max = 20): number {
  if (!Number.isFinite(n)) return DEFAULT_MAX_SEARCH_RESULTS;
  return Math.min(max, Math.max(1, Math.floor(n)));
}

export function truncateText(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars), truncated: true };
}
