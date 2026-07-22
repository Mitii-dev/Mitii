/**
 * Shared regex vocabulary for route resolution. Centralized so a new synonym or verb
 * only needs to change in one place instead of being hunted down across files.
 */

/** Destructive/irreversible operation keywords — shared by TaskAnalyzer and the risk engine. */
export const DESTRUCTIVE_OPERATION_RE =
  /\b(delete|drop|purge|rewrite history|force push|reset --hard)\b/i;

/** Verbs that describe inspecting/explaining rather than changing anything. */
export const READ_ONLY_VERBS_RE =
  /\b(explain|describe|summarize|review|inspect|analy[sz]e|find|locate|where|what|why|how)\b/i;

/** Verbs that authorize a change to the workspace, repository, or a remote system. */
export const MUTATION_VERBS_RE =
  /\b(update|edit|write|create|add|remove|fix|implement|change|refactor|migrate)\b/i;

/** Act intents that authorize a write regardless of surface wording (e.g. an explicit askIntent). */
export const WRITE_AUTHORIZING_ACT_INTENTS = new Set(['bugfix', 'feature', 'refactor', 'docs']);

/** Keywords suggesting the operation targets a remote/production system rather than the local workspace. */
export const REMOTE_OR_PRODUCTION_RE =
  /\b(production|prod\b|deploy|release|publish|remote server|live environment)\b/i;
