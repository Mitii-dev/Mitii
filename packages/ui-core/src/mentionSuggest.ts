/**
 * Composer `@` mention detection — skills, MCP, paths, or combined “all”.
 */

export type MentionSuggestMode = 'all' | 'skill' | 'mcp' | 'path';

export interface MentionSuggestState {
  mode: MentionSuggestMode;
  /** Partial filter after the mention token. */
  query: string;
}

/**
 * Inspect the trailing `@…` token. Returns null when not in a mention.
 *
 * - Bare `@` → skills + MCP + paths together
 * - `@foo` / `@request intake` → paths only (spaces allowed; search normalizes)
 * - `@skill:` / `@skill:foo` → skills only
 * - `@mcp:` / `@mcp:foo` → MCP only
 */
export function detectMentionSuggest(value: string): MentionSuggestState | null {
  const skill = value.match(/@skill:?([a-z0-9_.-]*)$/i);
  if (skill) {
    return { mode: 'skill', query: (skill[1] ?? '').toLowerCase() };
  }

  const mcp = value.match(/@mcp:?([a-z0-9_-]*)$/i);
  if (mcp) {
    return { mode: 'mcp', query: (mcp[1] ?? '').toLowerCase() };
  }

  // Allow spaces so `@request intake` stays an active mention until Enter.
  const at = value.match(/@([\w./_\- ]*)$/);
  if (!at) return null;
  const query = (at[1] ?? '').toLowerCase().replace(/\s+$/g, '');
  if (query.length === 0) {
    return { mode: 'all', query: '' };
  }
  return { mode: 'path', query };
}

/** Strip trailing @mention token from the composer text. */
export function stripTrailingMention(value: string): string {
  return value
    .replace(/@skill:?[a-z0-9_.-]*$/i, '')
    .replace(/@mcp:?[a-z0-9_-]*$/i, '')
    .replace(/@([\w./_\- ]*)$/, '')
    .replace(/[ \t]+$/g, '');
}
