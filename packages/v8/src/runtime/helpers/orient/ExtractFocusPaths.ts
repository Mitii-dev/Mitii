/**
 * Cheap path-like focus extraction for Orient (§4.3).
 * Mentions become focus — never mutationFence by themselves.
 */

const PATH_LIKE =
  /(?:@)?((?:[\w.@+-]+\/)+[\w.@+-]+(?:\.[\w.+-]+)?|[\w.@+-]+\.[\w.+-]+)/g;

export function extractFocusPaths(text: string, limit = 12): string[] {
  const hits: string[] = [];
  for (const match of text.matchAll(PATH_LIKE)) {
    const raw = match[1];
    if (!raw) continue;
    const normalized = raw.replace(/\\/g, "/").replace(/\/+$/, "");
    if (normalized.length === 0) continue;
    hits.push(normalized);
  }
  return [...new Set(hits)].slice(0, limit);
}
