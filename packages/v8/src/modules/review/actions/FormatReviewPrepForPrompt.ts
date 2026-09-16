import type { ReviewPrepResult } from "../contracts";

/** Serialize prepare output for prompt construction / agent context. */
export function formatReviewPrepForPrompt(prep: ReviewPrepResult): string {
  const lines: string[] = [
    `# Review prep (${prep.mode}, effort=${prep.effort}, rounds=${prep.maxReviewRounds})`,
    `Selected ${prep.selectedCount} file(s); excluded ${prep.excludedCount}.`,
    "",
    "## Files",
  ];
  for (const file of prep.files) {
    lines.push(
      `- ${file.path}: ${file.willReview ? "will_review" : `excluded(${file.excludeReason})`} (+${file.insertions}/-${file.deletions})`,
    );
  }
  lines.push("", "## Groups");
  for (const group of prep.groups) {
    lines.push(`- ${group.groupId} ${group.label}: ${group.paths.join(", ")}`);
  }
  lines.push("", "## Rule groups");
  for (const rule of prep.ruleGroups) {
    lines.push(`### ${rule.source} :: ${rule.pattern}`);
    lines.push(`Paths: ${rule.paths.join(", ")}`);
    lines.push(rule.rule);
    lines.push("");
  }
  if (prep.background) {
    lines.push("## Background", prep.background);
  }
  lines.push(
    "",
    "## Structured findings (required)",
    "You MUST call emit_review_finding at least once before finishing.",
    "Use one call per high-signal issue with path, content, existingCode, severity, and category.",
    "If there are no material issues, emit a single low/info finding that says so and names the covered scope.",
    "Prose-only analysis is not a valid review. Prefer covering selected will_review files over filename-casing digressions.",
  );
  return lines.join("\n");
}
