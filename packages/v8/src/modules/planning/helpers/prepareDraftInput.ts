import type {
  PlanStrategyDecision,
  PlanningParsedInput,
} from "../contracts";
import { isThinDiscoveryBriefForDraft } from "./discoveryDraftQuality";
import { thinDiscoveryBriefForClarify } from "./thinDiscoveryBriefForClarify";

/**
 * When discovery evidence is thin or strategy is clarify, drop process skills
 * (and strip change surfaces on clarify) so drafting cannot invent file work.
 */
export function prepareDraftInput(
  parsed: PlanningParsedInput,
  strategy: PlanStrategyDecision,
): PlanningParsedInput {
  if (strategy.strategy === "clarify") {
    return {
      ...parsed,
      skills: [],
      discoveryBrief: thinDiscoveryBriefForClarify(parsed.discoveryBrief),
    };
  }
  if (
    strategy.strategy === "discover_and_plan" &&
    parsed.discoveryBrief &&
    isThinDiscoveryBriefForDraft(parsed.discoveryBrief)
  ) {
    return {
      ...parsed,
      skills: [],
    };
  }
  return parsed;
}
