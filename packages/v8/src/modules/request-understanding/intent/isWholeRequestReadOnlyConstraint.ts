/**
 * Detect whole-request read-only / no-mutation asks.
 *
 * Scoped constraints must NOT match, for example:
 * - "Do not refactor Tablet/Appium unless …"
 * - "Do not change test intent/coverage; only encapsulate selectors"
 * - "Implement auth. Do not implement logging yet."
 *
 * Those are implementation constraints on an otherwise mutating ask
 * ("Fix …", "Implement …"), not a request to stay read-only.
 */
export function isWholeRequestReadOnlyConstraint(message: string): boolean {
  const text = message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  if (text.length === 0) {
    return false;
  }

  if (
    /\b(?:explain|review|diagnose|analyze|investigate)\s+only\b/i.test(text) ||
    /\bno\s+(?:code|file)\s+changes\b/i.test(text) ||
    /\bread[- ]only\b/i.test(text) ||
    /\b(?:do not|don't|dont)\s+(?:make|perform|apply)\s+any\s+(?:code\s+)?(?:changes|edits|modifications)\b/i.test(
      text,
    ) ||
    /\b(?:do not|don't|dont)\s+(?:edit|change|modify|touch|update|remove|refactor|fix|write)\s+(?:any\s+)?(?:files?|code|the\s+codebase|anything)\b/i.test(
      text,
    )
  ) {
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
    /\b(?:do not|don't|dont|without)\s+(?:edit|change|modify|fix|implement|apply|write|update|remove|refactor|touch)\b/i.test(
      text,
    )
  );
}

function hasMutatingPrimaryAsk(text: string): boolean {
  if (
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+want\s+you\s+to\s+|i\s+need\s+you\s+to\s+)?(?:fix|implement|add|build|create|design|develop|write|update|modify|remove|delete|refactor|restructure|rewrite|migrate|convert|configure|optimize|scaffold|generate|patch|repair|resolve)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  // Structured briefs often bury the verb under headings.
  if (
    /\b(?:##\s*)?(?:requirements|done when|acceptance|verification checklist|constraints)\b/i.test(
      text,
    ) &&
    /\b(?:fix|implement|add|build|create|refactor|update|migrate|configure|encapsulate|move)\b/i.test(
      text,
    )
  ) {
    return true;
  }

  return false;
}
