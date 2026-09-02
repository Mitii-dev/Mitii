import type { SkillCatalogItem } from './protocol';

/** Filter catalog items for `@skill:` autocomplete (id or title substring). */
export function filterSkillSuggestions(
  items: readonly SkillCatalogItem[],
  query: string,
): SkillCatalogItem[] {
  if (!query) {
    return [...items];
  }
  const q = query.toLowerCase();
  return items.filter(
    (item) =>
      item.id.toLowerCase().includes(q) ||
      item.name.toLowerCase().includes(q),
  );
}

/** True when a host catalog response belongs to the active composer suggest request. */
export function isActiveSkillSuggestRequest(
  requestId: string,
  activeRequestId: string,
): boolean {
  return requestId.length > 0 && requestId === activeRequestId;
}

export interface SkillCatalogSuggestSideEffects {
  clearSuggestLoading: true;
  suggestOpen: true;
  activeSuggest: 0;
}

/**
 * Composer `@skill:` / `/` picker should stop loading only for the matching
 * in-flight request (same contract as `paths.results`).
 */
export function skillCatalogSuggestSideEffects(
  requestId: string,
  activeRequestId: string,
): SkillCatalogSuggestSideEffects | undefined {
  if (!isActiveSkillSuggestRequest(requestId, activeRequestId)) {
    return undefined;
  }
  return {
    clearSuggestLoading: true,
    suggestOpen: true,
    activeSuggest: 0,
  };
}

/** Returns the partial id after `@skill:` at end of input, or null. */
export function detectSkillMentionQuery(value: string): string | null {
  const skillMatch = value.match(/@skill:([a-z0-9_.-]*)$/i);
  if (!skillMatch) {
    return null;
  }
  return (skillMatch[1] ?? '').toLowerCase();
}
