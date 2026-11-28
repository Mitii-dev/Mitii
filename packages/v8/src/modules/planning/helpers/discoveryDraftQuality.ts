import type {
  DiscoveryBrief,
  PlanArtifact,
  PlanStrategyDecision,
  PlanningParsedInput,
} from "../contracts";

/**
 * Plan (and Agent-visible) asks must not terminalize on the deterministic
 * discovery skeleton when discovery already produced surfaces and the ask is
 * multi-item / medium+ / multi-surface. Either a model draft lands or we clarify.
 */
export function requiresNonSkeletonDiscoveryDraft(params: {
  input: PlanningParsedInput;
  strategy: PlanStrategyDecision;
}): boolean {
  if (params.strategy.strategy !== "discover_and_plan") {
    return false;
  }
  if (isThinDiscoveryBriefForDraft(params.input.discoveryBrief)) {
    return false;
  }
  const taskSize = params.input.evidence.taskSize;
  const mediumOrLarge = taskSize === "medium" || taskSize === "large";
  const multiItem = looksLikeMultiItemPlanningQuery(params.input.query);
  // Multi-surface discovery skeletons already list concrete targetRefs — those
  // are not hollow. Require a model draft for medium+/multi-item asks only.

  if (params.input.mode === "plan") {
    return mediumOrLarge || multiItem;
  }
  if (
    params.input.mode === "agent" &&
    params.input.planningDepth === "visible"
  ) {
    return mediumOrLarge || multiItem;
  }
  return false;
}

export function isThinDiscoveryBriefForDraft(
  brief: DiscoveryBrief | undefined,
): boolean {
  if (!brief) {
    return true;
  }
  return (
    brief.confidence === "low" || brief.proposedChangeSurfaces.length === 0
  );
}

/**
 * True when Change steps are still the deterministic discovery-surface rows
 * (no model draft applied), which is hollow for multi-item Plan asks.
 */
export function isGenericDiscoverySkeletonPlan(plan: PlanArtifact): boolean {
  const changePhases = plan.phases.filter((phase) =>
    /change|implement|fix|build|apply|edit|update/i.test(phase.name),
  );
  if (changePhases.length === 0) {
    return false;
  }
  const changeSteps = changePhases.flatMap((phase) => phase.steps);
  if (changeSteps.length === 0) {
    return true;
  }
  const allSurfaceRows = changeSteps.every((step) =>
    step.id.startsWith("step-change-surface-"),
  );
  // A multi-surface discovery skeleton is already concrete; only the single
  // generic "Change <path>" row is treated as hollow.
  return allSurfaceRows && changeSteps.length <= 1;
}

export function clarifyStrategyAfterFailedDiscoveryDraft(
  prior?: PlanStrategyDecision,
): PlanStrategyDecision {
  return {
    schemaVersion: 1,
    strategy: "clarify",
    rationale:
      "Plan requires a discovery-grounded Change/Verify draft; the deterministic skeleton is not enough for this ask.",
    skipDiscover: true,
    useBuildEvidence: false,
    confidence: prior?.confidence ?? 0.4,
  };
}

const MULTI_ITEM_QUERY =
  /(?:suggested\s+improvements|improvements?\s*\/\s*gaps|(?:^|\n)\s*(?:[-*]|\d+[.)])\s+\S.+(?:\n\s*(?:[-*]|\d+[.)])\s+\S.+){2,}|\|.+\|(?:\n\|.+\|){3,})/im;

export function looksLikeMultiItemPlanningQuery(query: string): boolean {
  return query.trim().length >= 120 && MULTI_ITEM_QUERY.test(query);
}
