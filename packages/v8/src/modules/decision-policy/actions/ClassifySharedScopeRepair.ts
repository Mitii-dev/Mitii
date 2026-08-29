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
