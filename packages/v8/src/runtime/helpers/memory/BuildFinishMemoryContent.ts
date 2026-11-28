/**
 * Build a short durable memory draft from finish-time run facts (S11-MEM).
 * Never dumps transcripts or secrets — objective + paths only.
 */

export function buildFinishMemoryContent(input: {
  route?: string;
  objective?: string;
  answerSummary?: string;
  changedPaths?: readonly string[];
  verifyStatus?: string;
}): string {
  const parts: string[] = [];
  if (input.route) parts.push(`route=${input.route}`);
  if (input.objective?.trim()) {
    parts.push(`objective: ${input.objective.trim().slice(0, 200)}`);
  }
  if (input.answerSummary?.trim()) {
    parts.push(`outcome: ${input.answerSummary.trim().slice(0, 240)}`);
  }
  if (input.changedPaths && input.changedPaths.length > 0) {
    parts.push(
      `files: ${input.changedPaths.slice(0, 8).join(", ")}`,
    );
  }
  if (input.verifyStatus) {
    parts.push(`verify=${input.verifyStatus}`);
  }
  const text = parts.join(" | ").trim();
  return text.length > 0 ? text : "agent execute completed";
}
