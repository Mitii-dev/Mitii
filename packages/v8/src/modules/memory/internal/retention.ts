import type { MemoryFact } from "../contracts";
import { MEMORY_THRESHOLDS } from "../policy";

const TYPE_SALIENCE: Record<MemoryFact["type"], number> = {
  architecture: 0.9,
  preference: 0.85,
  pattern: 0.8,
  bug: 0.7,
  workflow: 0.6,
  fact: 0.5,
};

/**
 * Ebbinghaus-style retention in [0, 1]. Expired facts are filtered
 * before this runs; this only ranks living facts.
 */
export function scoreMemoryRetention(fact: MemoryFact, now: Date): number {
  const created = Date.parse(fact.createdAt);
  const ageDays = Number.isFinite(created)
    ? Math.max(0, (now.getTime() - created) / 86_400_000)
    : 0;
  const accessBonus = Math.min(0.2, fact.accessCount * 0.02);
  const salience = Math.min(
    1,
    (TYPE_SALIENCE[fact.type] ?? 0.5) + accessBonus,
  );
  const decay = Math.exp(-MEMORY_THRESHOLDS.retentionLambda * ageDays);
  let boost = 0;
  const stamps =
    fact.accessLog.length > 0
      ? fact.accessLog
      : fact.lastAccessedAt
        ? [fact.lastAccessedAt]
        : [];
  for (const stamp of stamps) {
    const accessed = Date.parse(stamp);
    if (!Number.isFinite(accessed)) {
      continue;
    }
    const days = (now.getTime() - accessed) / 86_400_000;
    if (days > 0) {
      boost += 1 / days;
    }
  }
  return Math.min(
    1,
    salience * decay + boost * MEMORY_THRESHOLDS.retentionSigma,
  );
}

export function applyAccessTouch(
  fact: MemoryFact,
  at: string,
): MemoryFact {
  const accessLog = [...fact.accessLog, at].slice(
    -MEMORY_THRESHOLDS.maxAccessLog,
  );
  return {
    ...fact,
    accessCount: fact.accessCount + 1,
    lastAccessedAt: at,
    accessLog,
  };
}
