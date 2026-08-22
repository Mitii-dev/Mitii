import type { DiscoveryBrief } from "../contracts";
import type { PlanningParsedInput } from "../contracts";

export const DISCOVERED_PLAN_SYSTEM = [
  "You already looked at the repository through a bounded read-only discovery pass.",
  "Emit only Change and Verify steps from what you found — no Discover phase, discovery already ran.",
  "Ground every step in the discovery evidence (files read, proposed change surfaces).",
  "Do not invent files or targets that discovery did not surface.",
  "Prefer allowedTargets and proposedChangeSurfaces over README or package.json unless they appear there.",
  "If discovery evidence is thin, prefer openQuestions over invented file work.",
  "Return only JSON matching the provided schema.",
].join("\n");

export function renderDiscoveredPlanUserPrompt(params: {
  input: PlanningParsedInput;
  discoveryBrief: DiscoveryBrief;
}): string {
  const { input, discoveryBrief } = params;
  const allowedTargets = uniquePaths([
    ...(input.knownPathHints ?? []),
    ...(input.contextReviewed ?? []).map((ref) => ref.ref),
    ...(input.scopedRepoMap?.entries ?? []).map((entry) => entry.path),
    ...discoveryBrief.proposedChangeSurfaces.map((surface) => surface.path),
    ...discoveryBrief.filesRead.map((file) => file.path),
  ]).slice(0, 24);

  return [
    '<discovery_result trust="untrusted-data">',
    JSON.stringify(
      {
        query: input.query,
        objective: discoveryBrief.objective,
        confidence: discoveryBrief.confidence,
        allowedTargets,
        filesRead: discoveryBrief.filesRead.slice(0, 20),
        targets: discoveryBrief.targets.slice(0, 20),
        proposedChangeSurfaces: discoveryBrief.proposedChangeSurfaces.slice(0, 12),
        discoveredConstraints: discoveryBrief.discoveredConstraints.slice(0, 10),
        verificationHints: discoveryBrief.verificationHints.slice(0, 10),
        openQuestions: discoveryBrief.openQuestions.slice(0, 8),
      },
      null,
      2,
    ),
    "</discovery_result>",
  ].join("\n");
}

function uniquePaths(paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths) {
    const normalized = path.trim().replace(/\\/g, "/").replace(/^\.\//, "");
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

/** Thin briefs should not get a second inventing model draft. */
export function isThinDiscoveryBrief(brief: DiscoveryBrief): boolean {
  return (
    brief.confidence === "low" ||
    brief.proposedChangeSurfaces.length === 0
  );
}
