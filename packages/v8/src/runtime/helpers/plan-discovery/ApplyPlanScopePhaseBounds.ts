/**
 * After A/B/C scope pick: bound discovery seeds, shrink budget, stage next-phase offer.
 */

import {
  askNeedsPlanScopeFork,
  boundPreferredPathsForPlanScope,
  collectCompletedPlanScopeIds,
  formatNextPlanPhaseOffer,
  planScopeDiscoveryHint,
  planScopeProcessHint,
  remainingPlanScopeIds,
  resolvePlanScopeId,
  type PlanScopeId,
  type PlanningParsedInput,
} from "../../../modules/planning";
import type { DiscoveryPassBudget } from "../../../modules/window-budget";
import {
  resolveDiscoveryPassBudget,
  scaleDiscoveryPassBudget,
} from "../../../modules/window-budget";

export type PlanScopeChoiceParams = {
  query?: string;
  optionId?: string;
  outcomeNote?: string;
  label?: string;
  conversation?: readonly { role: string; content: string }[];
};

export type PlanScopePhaseBounds = {
  resolvedScopeId: PlanScopeId | undefined;
  scopeChoiceResolved: boolean;
  planningInput: PlanningParsedInput;
  discoveryPreferredPaths: string[];
  discoveryBudgetOverride: DiscoveryPassBudget | undefined;
  discoveryScopeHint: string | undefined;
  nextPlanPhaseOffer: string | undefined;
};

export function applyPlanScopePhaseBounds(params: {
  planningInput: PlanningParsedInput;
  knownPathHints: readonly string[];
  scopeChoice: PlanScopeChoiceParams;
  taskSize?: string;
  contextWindowTokens?: number;
  reasonCodes: string[];
}): PlanScopePhaseBounds {
  const resolvedScopeId = resolvePlanScopeId(params.scopeChoice);
  const scopeChoiceResolved = resolvedScopeId !== undefined;
  let planningInput = params.planningInput;
  let discoveryPreferredPaths = [...params.knownPathHints];
  let discoveryBudgetOverride: DiscoveryPassBudget | undefined;
  let discoveryScopeHint: string | undefined;
  let nextPlanPhaseOffer: string | undefined;

  if (!resolvedScopeId) {
    return {
      resolvedScopeId,
      scopeChoiceResolved,
      planningInput,
      discoveryPreferredPaths,
      discoveryBudgetOverride,
      discoveryScopeHint,
      nextPlanPhaseOffer,
    };
  }

  discoveryPreferredPaths = boundPreferredPathsForPlanScope(
    params.knownPathHints,
    resolvedScopeId,
  );
  discoveryBudgetOverride = scaleDiscoveryPassBudget(
    resolveDiscoveryPassBudget(params.taskSize, params.contextWindowTokens),
  );
  discoveryScopeHint = planScopeDiscoveryHint(resolvedScopeId);
  if (!params.reasonCodes.includes("plan_scope_bounds_applied")) {
    params.reasonCodes.push("plan_scope_bounds_applied");
  }

  // Campaign "next phase A/B" only when the ask was a true multi-outcome fork.
  const needsCampaign = askNeedsPlanScopeFork({
    clarity: planningInput.evidence.clarity,
    primaryIntent: planningInput.evidence.primaryIntent,
    requestedOutcomes: planningInput.evidence.requestedOutcomes,
    query: planningInput.query,
  });
  if (needsCampaign) {
    const completedScopes = collectCompletedPlanScopeIds({
      ...params.scopeChoice,
      currentScopeId: resolvedScopeId,
    });
    nextPlanPhaseOffer = formatNextPlanPhaseOffer({
      completedScopeId: resolvedScopeId,
      remaining: remainingPlanScopeIds(completedScopes),
    });
  }

  const processHint = planScopeProcessHint(resolvedScopeId);
  planningInput = {
    ...planningInput,
    processHints: [...(planningInput.processHints ?? []), processHint].slice(
      0,
      16,
    ),
  };

  return {
    resolvedScopeId,
    scopeChoiceResolved,
    planningInput,
    discoveryPreferredPaths,
    discoveryBudgetOverride,
    discoveryScopeHint,
    nextPlanPhaseOffer,
  };
}

export function boundImpactSeedsForPlanScope(
  paths: readonly string[],
  scopeId: PlanScopeId | undefined,
  maxPaths = 8,
): string[] {
  if (!scopeId || paths.length === 0) {
    return [...paths];
  }
  return boundPreferredPathsForPlanScope(paths, scopeId, maxPaths);
}
