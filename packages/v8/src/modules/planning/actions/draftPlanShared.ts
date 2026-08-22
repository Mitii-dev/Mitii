import type { PlanStep } from "../contracts";

export function step(
  id: string,
  intent: string,
  targetRefs: readonly string[],
  actionSummary: string,
  expectedOutcome: string,
  riskLevel: PlanStep["riskLevel"],
  verification?: string,
): PlanStep {
  return {
    id,
    intent,
    targetRefs: [...targetRefs],
    actionSummary,
    expectedOutcome,
    verification,
    riskLevel,
  };
}

export function clipPhrase(value: string, max: number): string {
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1))}…`;
}

export function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((v) => v.trim()).filter((v) => v.length > 0))];
}

export function chunkList<T>(items: readonly T[], size: number): T[][] {
  const batchSize = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    chunks.push([...items.slice(i, i + batchSize)]);
  }
  return chunks;
}

export function normalizePhaseName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "skill-phase";
}
