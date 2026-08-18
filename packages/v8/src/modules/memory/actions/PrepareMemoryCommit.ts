import { createHash } from "node:crypto";

import type { MemoryCommitParsedInput, MemoryFact } from "../contracts";
import { deriveConcepts } from "../internal/deriveConcepts";
import { jaccardSimilarity } from "../internal/jaccard";
import { redactMemoryContent } from "../internal/privacy";
import { MEMORY_THRESHOLDS } from "../policy";

export type PreparedMemoryCommit =
  | {
      ok: true;
      fact: MemoryFact;
      superseded?: MemoryFact;
      reinforced: boolean;
      redacted: boolean;
    }
  | { ok: false; reason: "retention" | "empty" | "duplicate" };

/**
 * Apply privacy, fingerprint, reinforce, and supersede policy before persist.
 */
export function prepareMemoryCommit(params: {
  input: MemoryCommitParsedInput;
  id: string;
  now: Date;
  existing?: readonly MemoryFact[];
}): PreparedMemoryCommit {
  const redacted = redactMemoryContent(params.input.content.trim());
  const content = redacted.content.trim();
  if (!content || isOnlyRedaction(content)) {
    return { ok: false, reason: "empty" };
  }

  let expiresAt = params.input.expiresAt;
  if (expiresAt && new Date(expiresAt).getTime() <= params.now.getTime()) {
    return { ok: false, reason: "retention" };
  }

  const createdAt = params.now.toISOString();
  const contentHash = fingerprintContent(content);
  const scoped = (params.existing ?? []).filter(
    (fact) =>
      fact.isLatest !== false && scopesEqual(fact.scope, params.input.scope),
  );

  const exact = scoped.find((fact) => fact.contentHash === contentHash);
  if (exact) {
    const ageMs = params.now.getTime() - Date.parse(exact.createdAt);
    if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < MEMORY_THRESHOLDS.dedupWindowMs) {
      return { ok: false, reason: "duplicate" };
    }
    return {
      ok: true,
      fact: {
        ...exact,
        content,
        accessCount: exact.accessCount + 1,
        lastAccessedAt: createdAt,
        accessLog: [...exact.accessLog, createdAt].slice(
          -MEMORY_THRESHOLDS.maxAccessLog,
        ),
        importance: Math.min(10, exact.importance + 1),
        contentHash,
      },
      reinforced: true,
      redacted: redacted.redacted,
    };
  }

  let superseded: MemoryFact | undefined;
  for (const existing of scoped) {
    if (jaccardSimilarity(content, existing.content) > MEMORY_THRESHOLDS.jaccardSupersede) {
      superseded = existing;
      break;
    }
  }

  const concepts = deriveConcepts({
    tags: params.input.tags,
    concepts: params.input.concepts,
    title: params.input.title,
    content,
  });

  const title =
    params.input.title ??
    (content.length > 80 ? `${content.slice(0, 79)}…` : content);

  return {
    ok: true,
    fact: {
      id: params.id,
      content,
      scope: params.input.scope,
      tags: [...params.input.tags],
      privacy: params.input.privacy,
      createdAt,
      ...(expiresAt ? { expiresAt } : {}),
      source: params.input.source,
      type: params.input.type,
      title,
      concepts,
      files: [...params.input.files],
      importance: params.input.importance,
      sourceIds: [...params.input.sourceIds],
      version: superseded ? (superseded.version ?? 1) + 1 : 1,
      isLatest: true,
      supersedes: superseded ? [superseded.id] : [],
      contentHash,
      accessCount: 0,
      accessLog: [],
    },
    superseded: superseded
      ? { ...superseded, isLatest: false }
      : undefined,
    reinforced: false,
    redacted: redacted.redacted,
  };
}

export function fingerprintContent(content: string): string {
  return createHash("sha256")
    .update(content.trim().toLowerCase())
    .digest("hex")
    .slice(0, 16);
}

function isOnlyRedaction(content: string): boolean {
  return /^\[REDACTED(?:_SECRET)?\](?:\s*\[REDACTED(?:_SECRET)?\])*$/.test(
    content,
  );
}

function scopesEqual(
  left: MemoryFact["scope"],
  right: MemoryFact["scope"],
): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "user") {
    return left.userId === right.userId;
  }
  if (left.kind === "workspace") {
    return left.workspaceId === right.workspaceId;
  }
  return left.projectId === right.projectId;
}
