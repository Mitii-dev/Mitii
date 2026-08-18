import type { MemoryFact } from "../contracts";
import { MEMORY_THRESHOLDS } from "../policy";

/**
 * Compact always-on prior from workspace facts. Appended only when the
 * retrieve budget still has room after ranked facts.
 */
export function buildWorkspaceProfile(facts: readonly MemoryFact[]): string | undefined {
  const files = new Map<string, number>();
  const concepts = new Map<string, number>();

  for (const fact of facts) {
    if (fact.isLatest === false) {
      continue;
    }
    for (const file of fact.files) {
      files.set(file, (files.get(file) ?? 0) + 1);
    }
    const labels = fact.concepts.length > 0 ? fact.concepts : fact.tags;
    for (const concept of labels) {
      concepts.set(concept, (concepts.get(concept) ?? 0) + 1);
    }
  }

  const topFiles = topKeys(files, MEMORY_THRESHOLDS.profileMaxFiles);
  const topConcepts = topKeys(concepts, MEMORY_THRESHOLDS.profileMaxConcepts);
  if (topFiles.length === 0) {
    return undefined;
  }

  const parts = ["Workspace memory profile."];
  if (topFiles.length > 0) {
    parts.push(`Frequent files: ${topFiles.join(", ")}.`);
  }
  if (topConcepts.length > 0) {
    parts.push(`Frequent concepts: ${topConcepts.join(", ")}.`);
  }
  return parts.join(" ");
}

function topKeys(counts: Map<string, number>, limit: number): string[] {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, limit)
    .map(([key]) => key);
}
