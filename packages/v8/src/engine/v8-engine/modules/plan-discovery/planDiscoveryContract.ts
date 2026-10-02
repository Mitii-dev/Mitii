import type { PlanStrategyDecision } from "../../../../modules/planning";
import type { AgentMode } from "../../../../modules/request-intake";

import { isPlanningFollowUp } from "../../actions/planningContext";
import { resolveShapedDiscoveryProfile } from "../shaped-discovery";

export type PlanningDepthForContract = "none" | "internal" | "visible";
export type PlanningTaskSizeForContract = "small" | "medium" | "large";

/**
 * Discovery contract before drafting.
 *
 * Plan mode: cold / shaped asks force discover_and_plan (user expects a
 * thorough one-shot plan with real files/paths).
 * Agent mode: medium/large taskSize, visible plan depth, or wide internal
 * get the same discovery-first contract, then execute — not a hollow
 * plan_from_ask.
 *
 * Architecture / big-task asks override incidental follow_evidence so
 * preflight diagnostics cannot skip discovery.
 */
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

function looksLikeArchitectureDiscoveryAsk(query: string): boolean {
  return /\b(?:architecture|restructure|reorganiz(?:e|ation)|page\s*objects?|\bpom\b|shared\s+base|cross-?platform|refactor\s+(?:the\s+)?(?:test|package|module|folder))\b/i.test(
    query,
  );
}

function looksLikeRepairAsk(query: string): boolean {
  return /\b(?:fix|repair|resolve|clear|debug)\b[\s\S]{0,120}\b(?:errors?|erros?|diagnostics?|failing|failure|typecheck|type\s+(?:errors?|erros?)|ts\s+(?:errors?|erros?)|compile|compilation|build|tests?)\b|\b(?:typecheck|build|tests?)\b[\s\S]{0,80}\b(?:failing|failure|errors?|erros?)\b/i.test(
    query,
  );
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

function isAgentDiscoveryRequiredTask(params: {
  planningDepth?: PlanningDepthForContract;
  agentWideScope?: boolean;
  taskSize?: PlanningTaskSizeForContract;
}): boolean {
  if (params.taskSize === "medium" || params.taskSize === "large") {
    return true;
  }
  return (
    params.planningDepth === "visible" ||
    (params.planningDepth === "internal" && params.agentWideScope === true)
  );
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

/** Wide-scope predicate shared with quality floor (mirrors ResolvePlanStrategy.hasWideScope). */
export function isAgentWidePlanningScope(evidence: {
  scope?: string;
  complexity?: string;
  recommendsPlanning?: boolean;
}): boolean {
  const scope = evidence.scope ?? "";
  const complexity = evidence.complexity ?? "";
  if (
    scope === "package" ||
    scope === "repository" ||
    scope === "workspace" ||
    scope === "multi_file"
  ) {
    return true;
  }
  if (complexity === "complex" || complexity === "very_complex") {
    return true;
  }
  return evidence.recommendsPlanning === true;
}
