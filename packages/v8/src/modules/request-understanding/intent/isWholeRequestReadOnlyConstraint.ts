/**
 * Detect whole-request read-only / no-mutation asks.
 *
 * Scoped constraints must NOT match, for example:
 * - "Do not refactor Tablet/Appium unless …"
 * - "Do not change test intent/coverage; only encapsulate selectors"
 * - "Implement auth. Do not implement logging yet."
 * - "dont remove all the stars, keep a few" (quantity tweak — still a write)
 *
 * Those are implementation constraints on an otherwise mutating ask
 * ("Fix …", "Implement …"), not a request to stay read-only.
 */

/**
 * Unambiguous no-write asks. Always blocks mutation grants, even when the LLM
 * ballot is ≥70% act (Decision Policy hard override).
 */
export function isHardWholeRequestReadOnlyConstraint(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  return (
    /\b(?:explain|review|diagnose|analyze|investigate)\s+only\b/i.test(text) ||
    /\bno\s+(?:code|file)\s+changes\b/i.test(text) ||
    /\bread[- ]only\b/i.test(text) ||
    /\b(?:do not|don't|dont)\s+(?:make|perform|apply)\s+any\s+(?:code\s+)?(?:changes|edits|modifications)\b/i.test(
      text,
    ) ||
    /\b(?:do not|don't|dont)\s+(?:edit|change|modify|touch|update|remove|refactor|fix|write)\s+(?:any\s+)?(?:files?|code|the\s+codebase|anything)\b/i.test(
      text,
    )
  );
}

export function isWholeRequestReadOnlyConstraint(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  if (isHardWholeRequestReadOnlyConstraint(text)) {
    return true;
  }

  // Mutating primary ask (or structured implementation brief) → treat
  // remaining "Do not X …" / "Do not implement Y" lines as scoped
  // constraints, not whole-request read-only.
  if (hasMutatingPrimaryAsk(text)) {
    return false;
  }

  return (
    /\bwithout\s+implementing\b/i.test(text) ||
    /\b(?:do not|don't|dont)\s+implement\b/i.test(text) ||
    // Broad "don't edit/change/…" — but NOT bare "don't remove …" (that often
    // means "remove less / keep some", which is still a write ask).
    /\b(?:do not|don't|dont|without)\s+(?:edit|change|modify|fix|implement|apply|write|update|refactor|touch)\b/i.test(
      text,
    ) ||
    // "Don't remove" only when clearly forbidding file/code removal.
    /\b(?:do not|don't|dont)\s+remove\s+(?:any\s+|all\s+)?(?:files?|code|the\s+codebase|anything|everything)\b/i.test(
      text,
    )
  );
}

function hasMutatingPrimaryAsk(text: string): boolean {
  if (
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+)?(?:fix|implement|add|build|create|design|develop|write|edit|replace|change|update|modify|remove|delete|refactor|restructure|rewrite|migrate|convert|configure|optimize|scaffold|generate|patch|repair|resolve)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // Quantity / tone tweaks: "dont remove all … keep a few", "keep some stars"
  if (
    /\b(?:keep|leave|restore|bring\s+back)\b[\s\S]{0,40}\b(?:few|some|more|less|fewer)\b/i.test(
      text,
    ) ||
    /\b(?:dont|don't|do\s+not)\s+remove\s+all\b/i.test(text) ||
    /\bnot\s+too\s+many\b/i.test(text)
  ) {
    return true;
  }

  // Structured briefs often bury the verb under headings.
  if (
    /\b(?:##\s*)?(?:requirements|done when|acceptance|verification checklist|constraints)\b/i.test(
      text,
    ) &&
    /\b(?:fix|implement|add|build|create|edit|replace|refactor|update|migrate|configure|encapsulate|move)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}
