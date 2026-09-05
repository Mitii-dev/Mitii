import type { RequestUnderstandingResult } from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";

import type {
  DecisionReasonCode,
  MutationBudget,
} from "../contracts";
import {
  DECISION_POLICY_THRESHOLDS,
  MUTATION_BUDGET_PROFILES,
} from "../policy";

export type MutationBudgetProfile = keyof typeof MUTATION_BUDGET_PROFILES;

export interface MutationBudgetResolution {
  mutationBudget: MutationBudget;
  profile: MutationBudgetProfile;
  reasonCodes: DecisionReasonCode[];
}

/**
 * Choose a mutation batch profile for write grants.
 * Large / multi-file / high-complexity tasks get a tight budget so each
 * model turn stays under typical provider maximumOutputTokens.
 */
export function resolveMutationBudget(params: {
  understanding: RequestUnderstandingResult;
  windowPolicy?: WindowPolicy;
}): MutationBudgetResolution {
  const { understanding, windowPolicy } = params;
  const profile = selectProfile(understanding);
  const reasonCode = profileToReasonCode(profile);
  const profileBudget = { ...MUTATION_BUDGET_PROFILES[profile] };
  const mutationBudget = windowPolicy
    ? mergeMutationBudget(profileBudget, windowPolicy.mutation)
    : profileBudget;
  const windowClamped =
    mutationBudget.maxPatchesPerCall < profileBudget.maxPatchesPerCall ||
    mutationBudget.maxUniqueFilesPerCall < profileBudget.maxUniqueFilesPerCall ||
    mutationBudget.maxPatchPayloadCharacters <
      profileBudget.maxPatchPayloadCharacters;

  return {
    mutationBudget,
    profile,
    reasonCodes: windowClamped
      ? [reasonCode, "mutation_budget_window_clamped"]
      : [reasonCode],
  };
}

function mergeMutationBudget(
  profileBudget: MutationBudget,
  windowMutation: WindowPolicy["mutation"],
): MutationBudget {
  return {
    maxPatchesPerCall: Math.min(
      profileBudget.maxPatchesPerCall,
      windowMutation.maxPatchesPerCall,
    ),
    maxUniqueFilesPerCall: Math.min(
      profileBudget.maxUniqueFilesPerCall,
      windowMutation.maxUniqueFilesPerCall,
    ),
    maxPatchPayloadCharacters: Math.min(
      profileBudget.maxPatchPayloadCharacters,
      windowMutation.maxPatchPayloadCharacters,
    ),
    preferredBatchSize: windowMutation.preferredBatchSize,
    requireBatchedExecution:
      profileBudget.requireBatchedExecution ||
      windowMutation.requireBatchedExecution,
  };
}

function selectProfile(
  understanding: RequestUnderstandingResult,
): MutationBudgetProfile {
  const taskAnalysis = understanding.taskAnalysis;
  const estimatedMax = taskAnalysis.estimatedFilesAffected?.maximum;
  const largeFileSpan =
    typeof estimatedMax === "number" &&
    estimatedMax >= DECISION_POLICY_THRESHOLDS.largeMutationFileThreshold;

  const tightScope =
    taskAnalysis.scope === "multi_file" ||
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace";

  const tightComplexity =
    taskAnalysis.complexity === "complex" ||
    taskAnalysis.complexity === "very_complex";

  const primary = understanding.intent.classification.primaryTaskIntent;
  // Scaffold / package-create work needs room for multi-file batches.
  // Ultra-tight budgets caused thrash on clone-package executes.
  if (isScaffoldLikeExecute(understanding)) {
    return "standard";
  }

  if (
    primary === "refactor" ||
    largeFileSpan ||
    (tightScope && tightComplexity) ||
    taskAnalysis.recommendsPlanning
  ) {
    return "tight";
  }

  const localized =
    taskAnalysis.scope === "single_location" &&
    (estimatedMax === undefined || estimatedMax <= 1);
  const simple =
    taskAnalysis.complexity === "trivial" ||
    taskAnalysis.complexity === "simple";

  if (localized && simple) {
    return "relaxed";
  }

  return "standard";
}

/**
 * Create/scaffold/migrate package work should not inherit the ultra-tight
 * refactor profile even when scope is package and planning is recommended.
 */
function isScaffoldLikeExecute(
  understanding: RequestUnderstandingResult,
): boolean {
  const primary = understanding.intent.classification.primaryTaskIntent;
  if (primary !== "feature" && primary !== "migrate" && primary !== "config") {
    return false;
  }
  const haystack = [
    ...(understanding.taskAnalysis.constraints ?? []),
    ...(understanding.taskAnalysis.requestedOutcomes ?? []),
    ...(understanding.intent.classification.secondaryTaskIntents ?? []),
    ...(understanding.intent.classification.taskHints?.recommendedSkillTags ??
      []),
  ]
    .join(" ")
    .toLowerCase();
  if (
    /\b(scaffold|clone|parity|boilerplate|package\s+template|create\s+package|new\s+package)\b/.test(
      haystack,
    )
  ) {
    return true;
  }
  return (
    understanding.taskAnalysis.scope === "package" &&
    (primary === "feature" || primary === "migrate") &&
    understanding.taskAnalysis.recommendsPlanning === true &&
    !/\brefactor\b/.test(haystack)
  );
}

function profileToReasonCode(
  profile: MutationBudgetProfile,
): DecisionReasonCode {
  switch (profile) {
    case "relaxed":
      return "mutation_budget_relaxed";
    case "tight":
      return "mutation_budget_tight";
    case "standard":
    default:
      return "mutation_budget_standard";
  }
}
