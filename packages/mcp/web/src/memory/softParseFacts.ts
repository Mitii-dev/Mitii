/**
 * Soft-parse Mitii facts.json without importing @mitii/v8.
 * Fail-closed: skip malformed rows; never throw on corrupt envelopes.
 */

export interface SoftMemoryFact {
  id: string;
  content: string;
  privacy: 'private' | 'shareable';
  title?: string;
  tags: string[];
  files: string[];
  type?: string;
  createdAt?: string;
}

export function softParseFactsEnvelope(raw: string): SoftMemoryFact[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!parsed || typeof parsed !== 'object') return [];
  const facts = (parsed as { facts?: unknown }).facts;
  if (!Array.isArray(facts)) return [];

  const out: SoftMemoryFact[] = [];
  for (const row of facts) {
    const fact = softParseFact(row);
    if (fact) out.push(fact);
  }
  return out;
}

function softParseFact(row: unknown): SoftMemoryFact | null {
  if (!row || typeof row !== 'object') return null;
  const obj = row as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id.trim() : '';
  const content = typeof obj.content === 'string' ? obj.content.trim() : '';
  if (!id || !content) return null;
  const privacy =
    obj.privacy === 'shareable' || obj.privacy === 'private'
      ? obj.privacy
      : 'private';
  return {
    id,
    content,
    privacy,
    ...(typeof obj.title === 'string' && obj.title.trim()
      ? { title: obj.title.trim() }
      : {}),
    tags: stringArray(obj.tags),
    files: stringArray(obj.files),
    ...(typeof obj.type === 'string' ? { type: obj.type } : {}),
    ...(typeof obj.createdAt === 'string' ? { createdAt: obj.createdAt } : {}),
  };
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim());
}

/** Case-insensitive substring / tag / file match. */
export function rankShareableFacts(
  facts: readonly SoftMemoryFact[],
  query: string,
  limit: number,
): SoftMemoryFact[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const tokens = q.split(/\s+/).filter(Boolean);
  const scored = facts
    .filter((fact) => fact.privacy === 'shareable')
    .map((fact) => {
      const hay = [
        fact.content,
        fact.title ?? '',
        fact.tags.join(' '),
        fact.files.join(' '),
        fact.type ?? '',
      ]
        .join('\n')
        .toLowerCase();
      let score = 0;
      for (const token of tokens) {
        if (hay.includes(token)) score += 1;
      }
      if (hay.includes(q)) score += 2;
      return { fact, score };
    })
    .filter((row) => row.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score || a.fact.id.localeCompare(b.fact.id),
    );
  return scored.slice(0, Math.max(1, Math.min(50, limit))).map((row) => row.fact);
}
