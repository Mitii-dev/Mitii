import {
  hasResolvedPlanScopeChoice,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type { AgentMode } from "../../../modules/request-intake";

import { isPlanningFollowUp } from "./IsPlanningFollowUp";
import { resolveShapedDiscoveryProfile } from "../shaped-discovery";
import {
  forceDiscoverAndPlan,
  isAgentDiscoveryRequiredTask,
  looksLikeArchitectureDiscoveryAsk,
  looksLikeRepairAsk,
  type PlanningDepthForContract,
  type PlanningTaskSizeForContract,
} from "./PlanDiscoveryContractHelpers";

export type { PlanningDepthForContract, PlanningTaskSizeForContract } from "./PlanDiscoveryContractHelpers";
export { isAgentWidePlanningScope } from "./PlanDiscoveryContractHelpers";

export function applyPlanModeDiscoveryContract(params: {
  mode: AgentMode;
  explorationDepth?: "auto" | "quick" | "deep";
  query: string;
  conversation: readonly { role: string; content: string }[];
  strategy: PlanStrategyDecision;
  planningDepth?: PlanningDepthForContract;
  /** Wide Agent scopes (package+/complex+/recommendsPlanning). */
  agentWideScope?: boolean;
  /** Officer taskSize — medium/large force bounded discovery on Agent. */
  taskSize?: PlanningTaskSizeForContract;
}): {
  strategy: PlanStrategyDecision;
  applied: boolean;
  rationale?: string;
} {
  if (params.explorationDepth === "quick") {
    return { strategy: params.strategy, applied: false };
  }

  if (params.strategy.strategy === "follow_evidence") {
    if (shouldOverrideFollowEvidence(params)) {
      return {
        strategy: forceDiscoverAndPlan(
          params.strategy,
          params.mode === "plan"
            ? "Plan mode: architecture/big-task ask overrides diagnostic follow_evidence."
            : "Agent big-task: architecture ask overrides diagnostic follow_evidence.",
        ),
        applied: true,
        rationale:
          params.mode === "plan"
            ? "plan_architecture_overrides_follow_evidence"
            : "agent_architecture_overrides_follow_evidence",
      };
    }
    return { strategy: params.strategy, applied: false };
  }

  if (params.strategy.strategy === "discover_and_plan") {
    return { strategy: params.strategy, applied: false };
  }

  if (params.mode === "plan") {
    return applyPlanColdOrShapedContract(params);
  }

  if (params.mode === "agent") {
    return applyAgentBigTaskDiscoveryContract(params);
  }

  return { strategy: params.strategy, applied: false };
}

/**
 * follow_evidence stays for true repair. Architecture / POM / cold Plan /
 * Agent visible big-tasks force discovery instead.
 */
function shouldOverrideFollowEvidence(params: {
  mode: AgentMode;
  query: string;
  conversation: readonly { role: string; content: string }[];
  planningDepth?: PlanningDepthForContract;
  agentWideScope?: boolean;
  taskSize?: PlanningTaskSizeForContract;
}): boolean {
  if (looksLikeArchitectureDiscoveryAsk(params.query)) {
    return true;
  }
  if (params.mode === "plan") {
    if (looksLikeRepairAsk(params.query)) {
      return false;
    }
    const followUp = isPlanningFollowUp(params.query, params.conversation);
    if (!followUp) {
      return true;
    }
    return resolveShapedDiscoveryProfile(params.query) !== undefined;
  }
  if (params.mode === "agent") {
    const bigTask = isAgentDiscoveryRequiredTask(params);
    return bigTask && looksLikeArchitectureDiscoveryAsk(params.query);
  }
  return false;
}



function applyPlanColdOrShapedContract(params: {
  query: string;
  conversation: readonly { role: string; content: string }[];
  strategy: PlanStrategyDecision;
}): {
  strategy: PlanStrategyDecision;
  applied: boolean;
  rationale?: string;
} {
  const followUp = isPlanningFollowUp(params.query, params.conversation);
  if (followUp && params.strategy.strategy === "plan_from_ask") {
    return { strategy: params.strategy, applied: false };
  }

  // User already answered the Plan A/B/C scope fork — discover then draft,
  // never stay on clarify for another suspend loop.
  if (
    hasResolvedPlanScopeChoice({
      query: params.query,
      conversation: params.conversation,
    })
  ) {
    return {
      strategy: forceDiscoverAndPlan(
        params.strategy,
        "Plan mode: scope choice resolved — discover then draft a concrete plan.",
      ),
      applied: true,
      rationale: "plan_scope_choice_honored",
    };
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

function applyAgentBigTaskDiscoveryContract(params: {
  query: string;
  conversation: readonly { role: string; content: string }[];
  strategy: PlanStrategyDecision;
  planningDepth?: PlanningDepthForContract;
  agentWideScope?: boolean;
  taskSize?: PlanningTaskSizeForContract;
}): {
  strategy: PlanStrategyDecision;
  applied: boolean;
  rationale?: string;
} {
  if (!isAgentDiscoveryRequiredTask(params)) {
    return { strategy: params.strategy, applied: false };
  }

  // Agent follow-ups with known surfaces may keep plan_from_ask only for
  // small tasks. Medium/large always rediscover (bounded).
  const followUp = isPlanningFollowUp(params.query, params.conversation);
  const mediumOrLarge =
    params.taskSize === "medium" || params.taskSize === "large";
  if (
    followUp &&
    params.strategy.strategy === "plan_from_ask" &&
    !mediumOrLarge
  ) {
    return { strategy: params.strategy, applied: false };
  }

  // User already answered findings A/B/C — discover then draft/execute that phase.
  if (
    hasResolvedPlanScopeChoice({
      query: params.query,
      conversation: params.conversation,
    })
  ) {
    return {
      strategy: forceDiscoverAndPlan(
        params.strategy,
        "Agent big-task: scope choice resolved — discover then draft a concrete phase plan.",
      ),
      applied: true,
      rationale: "plan_scope_choice_honored",
    };
  }

  const shapedProfile = resolveShapedDiscoveryProfile(params.query);
  if (shapedProfile) {
    return {
      strategy: forceDiscoverAndPlan(
        params.strategy,
        mediumOrLarge
          ? `Agent ${params.taskSize} task: ${shapedProfile.id} ask requires bounded discovery before drafting.`
          : `Agent big-task: ${shapedProfile.id} ask requires discovery before drafting.`,
      ),
      applied: true,
      rationale: shapedProfile.id,
    };
  }

  if (
    params.strategy.strategy === "plan_from_ask" ||
    params.strategy.strategy === "clarify"
  ) {
    return {
      strategy: forceDiscoverAndPlan(
        params.strategy,
        mediumOrLarge
          ? `Agent ${params.taskSize} task: bounded discovery before a concrete implementation plan, then execute.`
          : params.planningDepth === "visible"
            ? "Agent visible-plan task: discover repository surfaces before drafting, then execute."
            : "Agent wide-scope task: discover repository surfaces before drafting, then execute.",
      ),
      applied: true,
      rationale: mediumOrLarge ? `agent_${params.taskSize}_task` : "agent_big_task",
    };
  }

  return { strategy: params.strategy, applied: false };
}
