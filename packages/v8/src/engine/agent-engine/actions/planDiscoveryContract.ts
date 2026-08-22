import type { PlanStrategyDecision } from "../../../modules/planning";
import type { AgentMode } from "../../../modules/request-intake";

import { isPlanningFollowUp } from "./planningContext";
import { resolveShapedDiscoveryProfile } from "./shapedDiscovery";

export function applyPlanModeDiscoveryContract(params: {
  mode: AgentMode;
  explorationDepth?: "auto" | "quick" | "deep";
  query: string;
  conversation: readonly { role: string; content: string }[];
  strategy: PlanStrategyDecision;
}): {
  strategy: PlanStrategyDecision;
  applied: boolean;
  rationale?: string;
} {
  if (params.mode !== "plan") {
    return { strategy: params.strategy, applied: false };
  }
  if (params.explorationDepth === "quick") {
    return { strategy: params.strategy, applied: false };
  }
  if (params.strategy.strategy === "follow_evidence") {
    return { strategy: params.strategy, applied: false };
  }
  if (params.strategy.strategy === "discover_and_plan") {
    return { strategy: params.strategy, applied: false };
  }

  const followUp = isPlanningFollowUp(params.query, params.conversation);
  if (followUp && params.strategy.strategy === "plan_from_ask") {
    return { strategy: params.strategy, applied: false };
  }

  const shapedProfile = resolveShapedDiscoveryProfile(params.query);
  if (shapedProfile) {
    return {
      strategy: forceDiscoverAndPlan(
        params.strategy,
        `Plan mode: ${shapedProfile.id} ask requires discovery before drafting.`,
      ),
      applied: true,
      rationale: shapedProfile.id,
    };
  }

  if (!followUp) {
    return {
      strategy: forceDiscoverAndPlan(
        params.strategy,
        "Plan mode cold ask: discover repository surfaces before drafting.",
      ),
      applied: true,
    };
  }

  return { strategy: params.strategy, applied: false };
}

function forceDiscoverAndPlan(
  prior: PlanStrategyDecision,
  rationale: string,
): PlanStrategyDecision {
  return {
    schemaVersion: 1,
    strategy: "discover_and_plan",
    rationale,
    skipDiscover: false,
    useBuildEvidence: false,
    confidence: prior.confidence ?? 0.85,
  };
}
