/**
 * Concrete target-ref predicates (VTCode/Codex-shaped formulae, Mitii-adapted).
 * Rejects generic placeholders so Plan/Agent big-task plans stay file/symbol scoped.
 */

const VAGUE_TARGET =
  /^(?:the\s+)?(?:relevant|related|appropriate|necessary|needed|required|existing|current|main|key|core)?\s*(?:files?|code(?:base)?|project|repo(?:sitory)?|sources?|modules?|components?|areas?|parts?|places?|locations?|entrypoints?|surfaces?)$/i;

const PLACEHOLDER_TOKEN =
  /\b(?:tbd|todo|fixme|xxx|placeholder|\[(?:decision|path|file|symbol)\s*needed\]|<path>|<file>)\b/i;

/** Path-like, package path, or symbol-qualified ref. */
export function isConcretePlanTargetRef(ref: string): boolean {
  const value = ref.trim();
  if (value.length < 2 || value.length > 500) {
    return false;
  }
  if (PLACEHOLDER_TOKEN.test(value) || VAGUE_TARGET.test(value)) {
    return false;
  }
  // Path separators or file extension.
  if (/[\\/]/.test(value) || /\.\w{1,16}$/.test(value)) {
    return true;
  }
  // Symbol / qualified names: pkg::Item, Type.method, CamelCase token with alnum_.
  if (/::/.test(value) || /\w+\.\w+/.test(value)) {
    return true;
  }
  if (/^[A-Z][A-Za-z0-9_]+$/.test(value) || /^[a-z][A-Za-z0-9_]+$/.test(value)) {
    // Bare identifiers are weak; only accept when they look like code symbols
    // (snake/camel), not English words like "implement".
    if (/^(?:and|or|the|for|with|from|into|over|under|all|any|new)$/i.test(value)) {
      return false;
    }
    return /[_A-Z]/.test(value) || value.length >= 4;
  }
  return false;
}

/** Observable / command-like verification text (not empty prose placeholders). */
export function isConcretePlanVerification(text: string | undefined): boolean {
  if (!text) {
    return false;
  }
  const value = text.trim();
  if (value.length < 3 || PLACEHOLDER_TOKEN.test(value)) {
    return false;
  }
  if (VAGUE_TARGET.test(value)) {
    return false;
  }
  // Command tokens, scripts, or explicit check language.
  if (
    /\b(?:test|typecheck|lint|build|check|verify|assert|expect|run|pnpm|npm|yarn|cargo|go|pytest|vitest|jest|tsc|eslint|prettier)\b/i.test(
      value,
    )
  ) {
    return true;
  }
  // Manual / observable checks with enough substance (≥4 words).
  const words = value.split(/\s+/).filter(Boolean);
  return words.length >= 4;
}

export function changeLikePhaseName(name: string): boolean {
  return /change|implement|fix|build|apply|edit|update|migrate|refactor/i.test(
    name,
  );
}
