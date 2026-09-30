/**
 * Structured Mitii reviews (host Review UI / CLI) require at least one
 * `emit_review_finding` tool call. Prose-only answers are not a valid review.
 */

export function requiresStructuredReviewFindings(
  reasonCodes: readonly string[] | undefined,
): boolean {
  return reasonCodes?.includes("review_findings_structured") === true;
}

export function buildIncompleteReviewRecoveryMessage(): string {
  return [
    "This is a structured Mitii code review.",
    "You must call emit_review_finding at least once before finishing.",
    "Use one call per high-signal issue (path, content, existingCode, severity, category).",
    "If the selected diff has no material issues, emit a single low/info finding that says so and names the covered scope.",
    "Do not end with prose-only analysis.",
    "Do not digress into filename-casing rabbit holes or unbounded re-reads.",
    "Call emit_review_finding now for the selected review files.",
  ].join(" ");
}
