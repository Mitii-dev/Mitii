import type { PlanClarifyDraft } from "../contracts";

/**
 * User-facing Plan clarify answer: findings + scope forks (not Change YAML).
 */
export function formatClarifyAsAnswer(draft: PlanClarifyDraft): string {
  const lines: string[] = [
    "From discovery so far, the main issues are:",
    "",
  ];
  for (const finding of draft.findings) {
    lines.push(`- ${finding}`);
  }
  lines.push("");
  lines.push("Before I lock a plan, I need your choices:");
  lines.push("");
  lines.push("1. Scope — what should this plan cover?");
  lines.push("");
  for (const option of draft.scopeOptions) {
    lines.push(option.label);
    if (option.detail) {
      lines.push(`   ${option.detail}`);
    }
  }
  if (draft.deliveryOptions && draft.deliveryOptions.length > 0) {
    lines.push("");
    lines.push("2. First delivery — what do you want shipped first?");
    lines.push("");
    for (const option of draft.deliveryOptions) {
      lines.push(`- ${option.label}${option.detail ? `: ${option.detail}` : ""}`);
    }
  }
  lines.push("");
  lines.push(
    draft.replyHint ??
      "Reply with something like B + quality gate (or A + quick wins), and I will write a concrete phased plan against that.",
  );
  return lines.join("\n");
}
