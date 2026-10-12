import type { DiscoveryBrief, PlanningParsedInput } from "../contracts";

export const CLARIFY_PLAN_SYSTEM = [
  "You already ran a bounded read-only discovery pass over the repository.",
  "The ask is still multi-fork or discovery was insufficient for a concrete Change plan.",
  "Synthesize findings ONLY from the discovery evidence (files read, surfaces, constraints).",
  "Do not invent file Change steps, paths, or metrics that discovery did not surface.",
  "Emit a short findings list and 2–4 mutually exclusive scope options (A/B/C style).",
  "Optionally emit 2–3 first-delivery options (quick wins vs quality gate vs architecture).",
  "Return only JSON matching the provided schema.",
].join("\n");

export function renderClarifyPlanUserPrompt(params: {
  input: PlanningParsedInput;
  discoveryBrief?: DiscoveryBrief;
}): string {
  const { input, discoveryBrief } = params;
  return [
    "<clarify_request>",
    JSON.stringify(
      {
        query: input.query,
        clarity: input.evidence.clarity,
        scope: input.evidence.scope,
        taskSize: input.evidence.taskSize,
        discovery: discoveryBrief
          ? {
              objective: discoveryBrief.objective,
              confidence: discoveryBrief.confidence,
              filesRead: discoveryBrief.filesRead.slice(0, 16).map((file) => ({
                path: file.path,
                reason: file.reason,
              })),
              proposedChangeSurfaces: discoveryBrief.proposedChangeSurfaces
                .slice(0, 8)
                .map((surface) => ({
                  path: surface.path,
                  actionHint: surface.actionHint,
                })),
              openQuestions: discoveryBrief.openQuestions.slice(0, 6),
              discoveredConstraints:
                discoveryBrief.discoveredConstraints.slice(0, 6),
            }
          : null,
      },
      null,
      2,
    ),
    "</clarify_request>",
  ].join("\n");
}
