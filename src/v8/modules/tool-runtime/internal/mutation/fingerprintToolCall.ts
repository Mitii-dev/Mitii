import { createHash } from "node:crypto";

/**
 * Stable fingerprint for approval matching. Same tool + args ⇒ same id.
 */
export function fingerprintToolCall(
  toolName: string,
  argumentsValue: unknown,
): string {
  const payload = stableStringify({ toolName, arguments: argumentsValue });
  return createHash("sha256").update(payload).digest("hex").slice(0, 32);
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      sorted[key] = sortKeys(record[key]);
    }
    return sorted;
  }
  return value;
}
