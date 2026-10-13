import type { PlanClarifyDraft } from "../contracts";

/**
 * User-facing Plan clarify answer: short findings + scope labels.
 * Option chips/cards carry the detail — keep chat text scannable.
 */
export function formatClarifyAsAnswer(draft: PlanClarifyDraft): string {
  const findings = draft.findings
    .map((finding) => finding.trim())
    .filter(Boolean)
    .slice(0, 2)
    .map((finding) =>
      finding.length > 160 ? `${finding.slice(0, 157).trimEnd()}…` : finding,
    );

  const lines: string[] = [];
  if (findings.length > 0) {
    lines.push("Need a scope choice before locking a plan:");
    for (const finding of findings) {
      lines.push(`- ${finding}`);
    }
  } else {
    lines.push("Need a scope choice before locking a plan.");
  }

  lines.push("");
  lines.push("Pick one:");
  for (const option of draft.scopeOptions.slice(0, 5)) {
    lines.push(`- ${option.label}`);
  }

  const hint =
    draft.replyHint?.trim() ||
    "Reply A, B, or C (optionally + delivery), then I will write the plan.";
  lines.push("");
  lines.push(hint.length > 120 ? `${hint.slice(0, 117).trimEnd()}…` : hint);

  return lines.join("\n");
}
