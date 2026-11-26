/**
 * Shared helpers for Plan / Agent discovery contract (runtime-owned).
 */

import type { PlanStrategyDecision } from "../../../modules/planning";

export type PlanningDepthForContract = "none" | "internal" | "visible";
export type PlanningTaskSizeForContract = "small" | "medium" | "large";

export function looksLikeArchitectureDiscoveryAsk(query: string): boolean {
  return /\b(?:architecture|restructure|reorganiz(?:e|ation)|page\s*objects?|\bpom\b|shared\s+base|cross-?platform|refactor\s+(?:the\s+)?(?:test|package|module|folder))\b/i.test(
    query,
  );
}

export function looksLikeRepairAsk(query: string): boolean {
  return /\b(?:fix|repair|resolve|clear|debug)\b[\s\S]{0,120}\b(?:errors?|erros?|diagnostics?|failing|failure|typecheck|type\s+(?:errors?|erros?)|ts\s+(?:errors?|erros?)|compile|compilation|build|tests?)\b|\b(?:typecheck|build|tests?)\b[\s\S]{0,80}\b(?:failing|failure|errors?|erros?)\b/i.test(
    query,
  );
}

export function isAgentDiscoveryRequiredTask(params: {
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

export function forceDiscoverAndPlan(
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
