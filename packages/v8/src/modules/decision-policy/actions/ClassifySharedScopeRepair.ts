import type { RequestUnderstandingResult } from "../../request-understanding";

import { DECISION_POLICY_THRESHOLDS } from "../policy";
import { DECISION_POLICY_PATTERNS } from "../patterns";

const BROAD_REPAIR_INTENTS = new Set([
  "bugfix",
  "refactor",
  "migrate",
  "schema",
  "security",
]);

/** Intents that reshape shared contracts even on a single seed file. */
const SHARED_SURFACE_INTENTS = new Set([
  "schema",
  "refactor",
  "migrate",
  "scaffold",
  "security",
]);

const SKIP_RECOMMEND_INTENTS = new Set([
  "style",
  "format",
  "docs",
  "question",
]);

const SHARED_SCOPES = new Set([
  "multi_file",
  "package",
  "repository",
  "workspace",
]);

/**
 * True when execute work spans shared surfaces and needs a visible plan /
 * change-impact pass rather than reactive single-file patching.
 * Host/language-neutral: uses intent taxonomy, scope, complexity, and generic
 * "fix all / across package" phrasing — not language-specific keywords.
 */
export function isBroadSharedScopeRepair(params: {
  primaryTaskIntent: string;
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"];
  message: string;
}): boolean {
  const { primaryTaskIntent, taskAnalysis, message } = params;
  if (!BROAD_REPAIR_INTENTS.has(primaryTaskIntent)) {
    return false;
  }

  if (SHARED_SCOPES.has(taskAnalysis.scope)) {
    return true;
  }

  const estimatedMax = taskAnalysis.estimatedFilesAffected?.maximum;
  if (
    typeof estimatedMax === "number" &&
    estimatedMax >= DECISION_POLICY_THRESHOLDS.multiFilePlanThreshold
  ) {
    return true;
  }

  if (
    taskAnalysis.complexity === "complex" ||
    taskAnalysis.complexity === "very_complex"
  ) {
    return true;
  }

  return DECISION_POLICY_PATTERNS.broadRepairRequest.test(message);
}

/** Elevate low residual risk when shared-scope repair is under-classified. */
export function shouldElevateSharedScopeRisk(params: {
  primaryTaskIntent: string;
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"];
  message: string;
}): boolean {
  if (params.taskAnalysis.risk !== "low") {
    return false;
  }
  return isBroadSharedScopeRepair(params);
}

/**
 * When to recommend `analyze_change_impact` (prompt + optional soft mutation gate).
 * Broader than {@link isBroadSharedScopeRepair}: type/API edits, typecheck fan-out,
 * symbol targets, multi-file estimates, and explicit blast-radius analysis asks.
 *
 * Does not decide tool grant membership — that stays on READ_ONLY affordability.
 */
export function shouldRecommendChangeImpact(params: {
  route: string;
  primaryTaskIntent: string;
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"];
  message: string;
}): boolean {
  const { route, primaryTaskIntent, taskAnalysis, message } = params;

  if (
    route === "clarify" ||
    route === "direct_answer"
  ) {
    return false;
  }

  if (DECISION_POLICY_PATTERNS.blastRadiusAnalysisRequest.test(message)) {
    return true;
  }

  if (SKIP_RECOMMEND_INTENTS.has(primaryTaskIntent)) {
    // Still allow blast-radius phrasing above; otherwise skip docs/style/question.
    return false;
  }

  if (hasExplicitSymbolTarget(taskAnalysis)) {
    return true;
  }

  if (DECISION_POLICY_PATTERNS.sharedSurfaceEditRequest.test(message)) {
    return true;
  }

  if (SHARED_SURFACE_INTENTS.has(primaryTaskIntent)) {
    return true;
  }

  if (
    (primaryTaskIntent === "bugfix" || primaryTaskIntent === "diagnose") &&
    DECISION_POLICY_PATTERNS.typecheckFanoutRequest.test(message)
  ) {
    return true;
  }

  if (
    isBroadSharedScopeRepair({
      primaryTaskIntent,
      taskAnalysis,
      message,
    })
  ) {
    return true;
  }

  if (SHARED_SCOPES.has(taskAnalysis.scope)) {
    // Feature / optimize / test work across multiple files still benefits
    // from impact before the first patch — not only repair intents.
    if (
      route === "execute" ||
      route === "plan" ||
      route === "diagnose"
    ) {
      return true;
    }
  }

  const estimatedMax = taskAnalysis.estimatedFilesAffected?.maximum;
  if (
    typeof estimatedMax === "number" &&
    estimatedMax >= DECISION_POLICY_THRESHOLDS.multiFilePlanThreshold &&
    (route === "execute" || route === "plan" || route === "diagnose")
  ) {
    return true;
  }

  return false;
}

function hasExplicitSymbolTarget(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
): boolean {
  return taskAnalysis.targets.some(
    (target) => target.explicit && target.kind === "symbol",
  );
}
