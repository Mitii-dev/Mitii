/**
 * Thin deterministic key — hash(toolId + normalized args + taskId).
 * Uses a stable stringify; cryptographic hash can replace later.
 */
export function buildIdempotencyKey(params: {
  toolId: string;
  args: unknown;
  taskId?: string;
}): string {
  const normalized = stableStringify(params.args);
  const task = params.taskId ?? "";
  return `${params.toolId}::${task}::${fnv1a(normalized)}`;
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(",")}}`;
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}
