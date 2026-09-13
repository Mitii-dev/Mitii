/**
 * Composer `@` mention detection — skills, MCP, paths, or combined “all”.
 * `@skill` / `@mcp` work with or without a trailing `:`.
 */

export type MentionSuggestMode = 'all' | 'skill' | 'mcp' | 'path';

export interface MentionSuggestState {
  mode: MentionSuggestMode;
  /** Partial filter after the mention token. */
  query: string;
}

/**
 * Inspect the trailing `@…` token. Returns null when the caret is not in a mention.
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

  const at = value.match(/@([\w./_-]*)$/);
  if (!at) {
    return null;
  }
  const query = (at[1] ?? '').toLowerCase();
  // Bare `@` → show skills + MCP + files together.
  if (query.length === 0) {
    return { mode: 'all', query: '' };
  }
  return { mode: 'path', query };
}
