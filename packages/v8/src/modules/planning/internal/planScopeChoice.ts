/**
 * Detect that the user already answered a Plan findings + A/B/C scope fork
 * so Engine must not re-clarify / re-suspend.
 */

const SCOPE_OPTION_ID = /^outcome:scope-[abc]\b/i;

const SCOPE_LABEL =
  /(?:Focused case hardening|Corpus-wide quality bar|Runner\s*\/\s*architecture changes)/i;

/** Clarification line from resume amend, or chip label text. */
const SCOPE_CLARIFICATION_LINE =
  /Clarification:\s*(?:[ABC]\)\s*)?(?:Focused case hardening|Corpus-wide quality bar|Runner\s*\/\s*architecture)/im;

export function hasResolvedPlanScopeChoice(params: {
  query?: string;
  optionId?: string;
  outcomeNote?: string;
  label?: string;
  conversation?: readonly { role: string; content: string }[];
}): boolean {
  if (params.optionId && SCOPE_OPTION_ID.test(params.optionId)) {
    return true;
  }
  if (params.outcomeNote && SCOPE_LABEL.test(params.outcomeNote)) {
    return true;
  }
  if (params.label && SCOPE_LABEL.test(params.label)) {
    return true;
  }

  const blobs: string[] = [];
  if (params.query?.trim()) {
    blobs.push(params.query);
  }
  for (const message of params.conversation ?? []) {
    if (message.role === "user" && message.content.trim()) {
      blobs.push(message.content);
    }
  }
  const text = blobs.join("\n");
  if (!text) {
    return false;
  }
  if (SCOPE_CLARIFICATION_LINE.test(text)) {
    return true;
  }
  if (SCOPE_OPTION_ID.test(text)) {
    return true;
  }
  // Free-text replies like "B + quality gate" after a scope-fork ask.
  if (
    /(?:^|\n)\s*[ABC]\s*([).:]|\s*\+)\s*/im.test(text) &&
    SCOPE_LABEL.test(text)
  ) {
    return true;
  }
  if (
    /\b(?:B\s*\+\s*quality\s*gate|A\s*\+\s*quick\s*wins|C\s*\+\s*architecture)\b/i.test(
      text,
    )
  ) {
    return true;
  }
  return false;
}
