import type { MemoryCommitInput, MemoryFact } from "../contracts";
import { MEMORY_THRESHOLDS } from "../policy";

/**
 * Apply retention/privacy commit policy before persisting a fact.
 */
export function prepareMemoryCommit(params: {
  input: MemoryCommitInput;
  id: string;
  now: Date;
}):
  | { ok: true; fact: MemoryFact }
  | { ok: false; reason: "retention" | "empty" } {
  const content = params.input.content.trim();
  if (!content) {
    return { ok: false, reason: "empty" };
  }

  const createdAt = params.now.toISOString();
  let expiresAt = params.input.expiresAt;
  if (!expiresAt) {
    const expiry = new Date(params.now);
    expiry.setUTCDate(
      expiry.getUTCDate() + MEMORY_THRESHOLDS.defaultRetentionDays,
    );
    expiresAt = expiry.toISOString();
  }

  if (new Date(expiresAt).getTime() <= params.now.getTime()) {
    return { ok: false, reason: "retention" };
  }

  return {
    ok: true,
    fact: {
      id: params.id,
      content,
      scope: params.input.scope,
      tags: [...params.input.tags],
      privacy: params.input.privacy,
      createdAt,
      expiresAt,
      source: params.input.source,
    },
  };
}
