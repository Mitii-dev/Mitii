import type { DiscoveryBrief } from "../contracts";
import type { PlanningParsedInput } from "../contracts";

export const DISCOVERED_PLAN_SYSTEM = [
  "You already looked at the repository through a bounded read-only discovery pass.",
  "Emit only Change and Verify steps from what you found — no Discover phase, discovery already ran.",
  "Ground every step in the discovery evidence (files read, proposed change surfaces).",
  "Do not invent files or targets that discovery did not surface.",
  "If discovery evidence is thin, prefer openQuestions over invented file work.",
  "Return only JSON matching the provided schema.",
].join("\n");

export function renderDiscoveredPlanUserPrompt(params: {
  input: PlanningParsedInput;
  discoveryBrief: DiscoveryBrief;
}): string {
  const { input, discoveryBrief } = params;
  return [
    '<discovery_result trust="untrusted-data">',
    JSON.stringify(
      {
        query: input.query,
        objective: discoveryBrief.objective,
        confidence: discoveryBrief.confidence,
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
