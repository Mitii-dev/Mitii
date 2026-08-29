import {
  WORKSPACE_BUG_ANCHOR,
  WORKSPACE_BUG_AT_WORKSPACE_REF,
  WORKSPACE_BUG_FAILURE_LANGUAGE,
  WORKSPACE_BUG_LOCALHOST,
  WORKSPACE_BUG_NAMED_ERROR,
  WORKSPACE_BUG_NOT_TYPO_MAX_DISTANCE,
  WORKSPACE_BUG_NOT_TYPO_MAX_LENGTH,
  WORKSPACE_BUG_NOT_TYPO_MIN_LENGTH,
  WORKSPACE_BUG_NOT_WORKING_EXACT,
  WORKSPACE_BUG_PACKAGE_FROM,
  WORKSPACE_BUG_REPO_PATH,
  WORKSPACE_BUG_RUNTIME_ERROR,
  WORKSPACE_BUG_WORD_BEFORE_WORKING,
} from "../patterns";

/**
 * Detect workspace-grounded bug reports that understanding often classifies
 * as generic "question". Used to promote agent-mode runs to execute.
 */
export function looksLikeWorkspaceBugReport(message: string): boolean {
  const text = message.trim();
  if (text.length === 0) {
    return false;
  }

  if (!hasWorkspaceBugFailureSignal(text)) {
    return false;
  }

  return hasWorkspaceBugAnchor(text);
}

function hasWorkspaceBugFailureSignal(text: string): boolean {
  if (WORKSPACE_BUG_FAILURE_LANGUAGE.test(text)) {
    return true;
  }
  if (WORKSPACE_BUG_RUNTIME_ERROR.test(text)) {
    return true;
  }
  if (WORKSPACE_BUG_NAMED_ERROR.test(text)) {
    return true;
  }
  // Typo-tolerant "not working" (e.g. "nbot working") beyond exact catalog hits.
  return hasNotWorkingSignal(text);
}

/**
 * Exact "not working" family, plus single-edit typos of "not" before
 * "working" (e.g. "nbot working").
 */
function hasNotWorkingSignal(text: string): boolean {
  if (WORKSPACE_BUG_NOT_WORKING_EXACT.test(text)) {
    return true;
  }

  WORKSPACE_BUG_WORD_BEFORE_WORKING.lastIndex = 0;
  for (const match of text.matchAll(WORKSPACE_BUG_WORD_BEFORE_WORKING)) {
    const token = match[1];
    if (token !== undefined && isNearMissNot(token)) {
      return true;
    }
  }
  return false;
}

function hasWorkspaceBugAnchor(text: string): boolean {
  return (
    WORKSPACE_BUG_ANCHOR.test(text) ||
    WORKSPACE_BUG_PACKAGE_FROM.test(text) ||
    WORKSPACE_BUG_AT_WORKSPACE_REF.test(text) ||
    WORKSPACE_BUG_REPO_PATH.test(text) ||
    WORKSPACE_BUG_LOCALHOST.test(text)
  );
}

function isNearMissNot(token: string): boolean {
  const normalized = token.toLowerCase().replace(/'/g, "");
  if (normalized === "not") {
    return true;
  }
  // Keep typo tolerance narrow: only n*-prefixed near-misses of "not"
  // (e.g. "nbot", "nto", "noot") — avoids "got working" false positives.
  if (!normalized.startsWith("n")) {
    return false;
  }
  if (
    normalized.length < WORKSPACE_BUG_NOT_TYPO_MIN_LENGTH ||
    normalized.length > WORKSPACE_BUG_NOT_TYPO_MAX_LENGTH
  ) {
    return false;
  }
  return (
    levenshteinDistance(normalized, "not") <= WORKSPACE_BUG_NOT_TYPO_MAX_DISTANCE
  );
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (curr[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + cost,
      );
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j] ?? 0;
    }
  }

  return prev[b.length] ?? b.length;
}
