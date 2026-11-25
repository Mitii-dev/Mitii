import type { DiscoveryBrief } from "./contracts";

const DEFAULT_CLARIFY_QUESTION =
  "Which concrete files, symbols, and verify commands should this plan cover before any Change steps?";

/**
 * Strip change surfaces from a discovery brief so clarify drafting cannot
 * invent file-scoped Change steps from partial / failed discovery.
 */
export function thinDiscoveryBriefForClarify(
  brief: DiscoveryBrief | undefined,
  extraQuestions: readonly string[] = [],
): DiscoveryBrief | undefined {
  if (!brief) {
    return undefined;
  }
  const openQuestions = uniqueStrings([
    ...brief.openQuestions,
    ...extraQuestions,
    DEFAULT_CLARIFY_QUESTION,
  ]).slice(0, 8);
  return {
    ...brief,
    confidence: "low",
    proposedChangeSurfaces: [],
    openQuestions,
  };
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}
