import type { RequestUnderstandingResult } from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";
import { resolveWindowBudgetBand } from "../../window-budget";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  PlanningDepth,
} from "../contracts";
import { DECISION_POLICY_THRESHOLDS } from "../policy";
import {
  isBroadSharedScopeRepair,
  shouldRecommendChangeImpact,
} from "./ClassifySharedScopeRepair";

export interface PlanningDepthResolution {
  planningDepth: PlanningDepth;
  reasonCodes: DecisionReasonCode[];
}

export function resolvePlanningDepth(params: {
  mode: "ask" | "plan" | "agent";
  route: ExecutionRoute;
  understanding: RequestUnderstandingResult;
  message: string;
  windowPolicy?: WindowPolicy;
}): PlanningDepthResolution {
  const { mode, route, understanding, message } = params;
  const { taskAnalysis, intent } = understanding;
  const reasonCodes: DecisionReasonCode[] = [];
  const primary = intent.classification.primaryTaskIntent;

  appendChangeImpactRecommend({
    reasonCodes,
    route,
    primaryTaskIntent: primary,
    taskAnalysis,
    message,
    windowPolicy: params.windowPolicy,
  });

  if (
    route === "clarify" ||
    route === "direct_answer" ||
    route === "repository_answer"
  ) {
    return { planningDepth: "none", reasonCodes };
  }

  if (route === "diagnose") {
    if (
      taskAnalysis.complexity === "complex" ||
      taskAnalysis.complexity === "very_complex" ||
      taskAnalysis.scope === "repository" ||
      taskAnalysis.scope === "workspace"
    ) {
      reasonCodes.push("multi_file_internal_plan");
      return { planningDepth: "internal", reasonCodes };
    }
    return { planningDepth: "none", reasonCodes };
  }

  if (mode === "plan" || route === "plan") {
    reasonCodes.push("explicit_plan_request");
    return { planningDepth: "visible", reasonCodes };
  }

  // Officer taskSize / planningHint → plan-then-finish (before localized shortcuts).
  const officerPlan = resolveOfficerTaskSizePlanningDepth({
    taskAnalysis,
    windowPolicy: params.windowPolicy,
  });
  if (officerPlan && mode === "agent" && route === "execute") {
    reasonCodes.push(...officerPlan.reasonCodes);
    return {
      planningDepth: officerPlan.planningDepth,
      reasonCodes,
    };
  }

  if (
    isArchitectureScale(taskAnalysis, primary, message) ||
    isLargeImplementationScale(taskAnalysis, primary, message)
  ) {
    if (isArchitectureScale(taskAnalysis, primary, message)) {
      reasonCodes.push("architecture_visible_plan");
    } else {
      reasonCodes.push("large_implementation_visible_plan");
    }
    return {
      planningDepth: isVisiblePlanAffordable(params.windowPolicy)
        ? "visible"
        : "internal",
      reasonCodes,
    };
  }

  if (
    mode === "agent" &&
    route === "execute" &&
    isBroadSharedScopeRepair({
      primaryTaskIntent: primary,
      taskAnalysis,
      message,
    })
  ) {
    if (isVisiblePlanAffordable(params.windowPolicy)) {
      reasonCodes.push("broad_repair_visible_plan");
      return { planningDepth: "visible", reasonCodes };
    }
    reasonCodes.push("multi_file_internal_plan");
    return { planningDepth: "internal", reasonCodes };
  }

  if (mode === "agent" && route === "execute") {
    const longPrompt = resolveLongPromptPlanningDepth({
      message,
      windowPolicy: params.windowPolicy,
    });
    if (longPrompt) {
      reasonCodes.push(...longPrompt.reasonCodes);
      return {
        planningDepth: longPrompt.planningDepth,
        reasonCodes,
      };
    }
  }

  if (isSimpleLocalized(taskAnalysis)) {
    reasonCodes.push("simple_localized_no_visible_plan");
    return { planningDepth: "none", reasonCodes };
  }

  if (
    taskAnalysis.scope === "multi_file" ||
    taskAnalysis.scope === "package" ||
    taskAnalysis.complexity === "moderate" ||
    taskAnalysis.complexity === "complex" ||
    taskAnalysis.recommendsPlanning
  ) {
    reasonCodes.push("multi_file_internal_plan");
    return { planningDepth: "internal", reasonCodes };
  }

  reasonCodes.push("simple_localized_no_visible_plan");
  return { planningDepth: "none", reasonCodes };
}

function appendChangeImpactRecommend(params: {
  reasonCodes: DecisionReasonCode[];
  route: ExecutionRoute;
  primaryTaskIntent: string;
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"];
  message: string;
  windowPolicy?: WindowPolicy;
}): void {
  if (!isChangeImpactAffordable(params.windowPolicy)) {
    return;
  }
  if (
    !shouldRecommendChangeImpact({
      route: params.route,
      primaryTaskIntent: params.primaryTaskIntent,
      taskAnalysis: params.taskAnalysis,
      message: params.message,
    })
  ) {
    return;
  }
  if (!params.reasonCodes.includes("change_impact_recommended")) {
    params.reasonCodes.push("change_impact_recommended");
  }
}

function isSimpleLocalized(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
): boolean {
  const lowComplexity =
    taskAnalysis.complexity === "trivial" ||
    taskAnalysis.complexity === "simple";
  const localized =
    taskAnalysis.scope === "single_location" ||
    (taskAnalysis.estimatedFilesAffected?.maximum !== undefined &&
      taskAnalysis.estimatedFilesAffected.maximum <= 1);
  const lowRisk =
    taskAnalysis.risk === "low" || taskAnalysis.risk === "medium";

  return lowComplexity && localized && lowRisk && taskAnalysis.risk !== "critical";
}

/**
 * Map RU Officer taskSize / planningHint to planningDepth.
 * Returns null when Officer left small/none (let classic heuristics decide).
 */
function resolveOfficerTaskSizePlanningDepth(params: {
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"];
  windowPolicy?: WindowPolicy;
}): PlanningDepthResolution | null {
  const { taskAnalysis } = params;
  const size = taskAnalysis.taskSize;
  const hint = taskAnalysis.planningHint;

  // Only fire when Officer (or sizeDraft) set an explicit band/hint.
  // Do not steal architecture / large-implementation visible plans from
  // recommendsPlanning alone.
  const explicitOfficerSignal =
    hint === "short" ||
    hint === "medium" ||
    hint === "long" ||
    size === "medium" ||
    size === "large";

  if (!explicitOfficerSignal) {
    return null;
  }

  const wantVisible = hint === "long" || size === "large";

  if (wantVisible && isVisiblePlanAffordable(params.windowPolicy)) {
    return {
      planningDepth: "visible",
      reasonCodes: ["officer_task_size_plan"],
    };
  }

  return {
    planningDepth: "internal",
    reasonCodes: ["officer_task_size_plan", "multi_file_internal_plan"],
  };
}

function isLargeImplementationScale(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
  primary: string,
  message: string,
): boolean {
  if (primary !== "feature" && primary !== "refactor") {
    return false;
  }
  const packageScale =
    taskAnalysis.scope === "package" ||
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace";
  if (!packageScale) {
    return false;
  }
  const estimatedMax = taskAnalysis.estimatedFilesAffected?.maximum;
  const largeByEstimate =
    estimatedMax !== undefined && estimatedMax >= 6;
  const largeByComplexity =
    taskAnalysis.complexity === "complex" ||
    taskAnalysis.complexity === "very_complex";
  const largeByMessage =
    /\b(entire|whole|full)\s+(package|module|library|builder|framework)\b/i.test(
      message,
    ) ||
    /\bimplement\s+(the\s+)?(entire|whole|full)\b/i.test(message) ||
    /\b(greenfield|from\s+scratch|like\s+\w+)\b/i.test(message);
  return (
    largeByEstimate ||
    (largeByComplexity && packageScale) ||
    (largeByMessage && packageScale) ||
    (taskAnalysis.recommendsPlanning && packageScale && largeByComplexity)
  );
}

function isArchitectureScale(
  taskAnalysis: RequestUnderstandingResult["taskAnalysis"],
  primary: string,
  message: string,
): boolean {
  if (primary === "migrate" || primary === "scaffold") {
    return true;
  }
  if (taskAnalysis.risk === "high" || taskAnalysis.risk === "critical") {
    return true;
  }
  if (
    taskAnalysis.scope === "repository" ||
    taskAnalysis.scope === "workspace"
  ) {
    return true;
  }
  if (taskAnalysis.complexity === "very_complex") {
    return true;
  }
  if (
    /\b(architecture|migrat(e|ion)|public\s+api|irreversible|across\s+the\s+(codebase|repository))\b/i.test(
      message,
    )
  ) {
    return true;
  }
  if (
    primary === "refactor" &&
    /\b(?:restructure|reorganize)\b/i.test(message) &&
    /\b(?:project|repo|repository|codebase|folder|directory|structure|layout)\b/i.test(
      message,
    )
  ) {
    return true;
  }
  return false;
}

function resolveLongPromptPlanningDepth(params: {
  message: string;
  windowPolicy?: WindowPolicy;
}): PlanningDepthResolution | null {
  const text = params.message.replace(/\nClarification:\s*[\s\S]*$/i, "").trim();
  const length = text.length;
  if (length === 0) {
    return null;
  }

  const band = resolveWindowBudgetBand(
    params.windowPolicy?.contextWindowTokens ?? 64_000,
  );
  const internalChars =
    DECISION_POLICY_THRESHOLDS.longPromptInternalPlanChars[band];
  const visibleChars =
    DECISION_POLICY_THRESHOLDS.longPromptVisiblePlanChars[band];

  if (length >= visibleChars && isVisiblePlanAffordable(params.windowPolicy)) {
    return {
      planningDepth: "visible",
      reasonCodes: ["long_prompt_visible_plan"],
    };
  }

  if (length >= internalChars) {
    return {
      planningDepth: "internal",
      reasonCodes: ["long_prompt_internal_plan"],
    };
  }

  return null;
}

function isVisiblePlanAffordable(windowPolicy?: WindowPolicy): boolean {
  return windowPolicy?.planning.visiblePlanAffordable !== false;
}

function isChangeImpactAffordable(windowPolicy?: WindowPolicy): boolean {
  return windowPolicy?.planning.changeImpactAffordable !== false;
}
