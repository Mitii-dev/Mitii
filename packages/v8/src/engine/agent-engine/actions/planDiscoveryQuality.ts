import type { DiscoveryBrief } from "../../../modules/planning";
import type { AgentMode } from "../../../modules/request-intake";

export type PlanningDepthForQuality = "none" | "internal" | "visible";

/**
 * When true, discovery must produce file-backed evidence before a concrete
 * plan is treated as ready.
 *
 * - Plan mode (except thoroughness Low / `quick`): always.
 * - Agent mode: only for big tasks already assigned a plan depth
 *   (`visible` / wide `internal`) — same foolproof bar as Plan, then execute.
 */
export function requiresPlanDiscoveryQualityFloor(params: {
  mode: AgentMode;
  explorationDepth?: "auto" | "quick" | "deep";
  planningDepth?: PlanningDepthForQuality;
  /** Wide Agent scopes (package+/complex+/recommendsPlanning). */
  agentWideScope?: boolean;
}): boolean {
  if (params.explorationDepth === "quick") {
    return false;
  }
  if (params.mode === "plan") {
    return true;
  }
  if (params.mode !== "agent") {
    return false;
  }
  if (params.planningDepth === "visible") {
    return true;
  }
  if (params.planningDepth === "internal" && params.agentWideScope === true) {
    return true;
  }
  return false;
}

/**
 * Plan-mode thoroughness (user expects a foolproof one-shot plan): align with
 * DiscoveryBrief high confidence — ≥2 productive reads and ≥2 change surfaces.
 * Agent big-task floor keeps the base medium bar unless `thorough` is set.
 */
export function isPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
  options?: { thorough?: boolean },
): boolean {
  if (options?.thorough) {
    return isThoroughPlanDiscoveryEvidenceSufficient(brief);
  }
  return (
    brief.filesRead.length >= 1 &&
    brief.proposedChangeSurfaces.length > 0 &&
    brief.confidence !== "low"
  );
}

/**
 * Foolproof Plan / Agent-visible discovery: multi-file, multi-surface,
 * non-low confidence (matches CompileDiscoveryBrief high band intent).
 */
export function isThoroughPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
): boolean {
  if (brief.confidence === "low") {
    return false;
  }
  // Foolproof Plan: at least two concrete file reads and one change surface.
  // Symbols on filesRead are preferred but not required (collector may lack LSP).
  return (
    brief.filesRead.length >= 2 && brief.proposedChangeSurfaces.length >= 1
  );
}

/** True when Plan (or Agent-visible) should use the thorough evidence bar. */
export function usesThoroughPlanDiscoveryEvidence(params: {
  mode: AgentMode;
  planningDepth?: PlanningDepthForQuality;
}): boolean {
  if (params.mode === "plan") {
    return true;
  }
  return params.mode === "agent" && params.planningDepth === "visible";
}

export function clarifyAfterInsufficientPlanDiscovery(
  priorConfidence?: number,
  options?: { thorough?: boolean },
): {
  schemaVersion: 1;
  strategy: "clarify";
  rationale: string;
  skipDiscover: true;
  useBuildEvidence: false;
  confidence: number;
} {
  return {
    schemaVersion: 1,
    strategy: "clarify",
    rationale: options?.thorough
      ? "Plan requires multi-file, multi-surface discovery before a concrete plan; evidence was insufficient."
      : "Plan mode requires file-backed discovery before a concrete plan; evidence was insufficient.",
    skipDiscover: true,
    useBuildEvidence: false,
    confidence: priorConfidence ?? 0.4,
  };
}
