import type { DiscoveryBrief } from "../../../modules/planning";
import type { AgentMode } from "../../../modules/request-intake";

/**
 * Plan mode (except thoroughness Low / `quick`) must produce file-backed
 * discovery evidence before a concrete plan is treated as ready.
 */
export function requiresPlanDiscoveryQualityFloor(params: {
  mode: AgentMode;
  explorationDepth?: "auto" | "quick" | "deep";
}): boolean {
  return params.mode === "plan" && params.explorationDepth !== "quick";
}

/**
 * Enough evidence to draft a file-scoped Plan: at least one read, a proposed
 * change surface, and non-low confidence.
 */
export function isPlanDiscoveryEvidenceSufficient(
  brief: Pick<
    DiscoveryBrief,
    "filesRead" | "proposedChangeSurfaces" | "confidence"
  >,
): boolean {
  return (
    brief.filesRead.length >= 1 &&
    brief.proposedChangeSurfaces.length > 0 &&
    brief.confidence !== "low"
  );
}

export function clarifyAfterInsufficientPlanDiscovery(
  priorConfidence?: number,
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
    rationale:
      "Plan mode requires file-backed discovery before a concrete plan; evidence was insufficient.",
    skipDiscover: true,
    useBuildEvidence: false,
    confidence: priorConfidence ?? 0.4,
  };
}
