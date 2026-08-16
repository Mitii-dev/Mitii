import type { RequestUnderstandingResult } from "../../request-understanding";
import type { WindowPolicy } from "../../window-budget";

import type {
  DecisionReasonCode,
  ExecutionRoute,
  PlanningDepth,
} from "../contracts";
import { isBroadSharedScopeRepair } from "./ClassifySharedScopeRepair";

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

  if (isArchitectureScale(taskAnalysis, primary, message)) {
    reasonCodes.push("architecture_visible_plan");
    if (
      mode === "agent" &&
      route === "execute" &&
      isChangeImpactAffordable(params.windowPolicy)
    ) {
      reasonCodes.push("change_impact_recommended");
    }
    return {
      planningDepth: isVisiblePlanAffordable(params.windowPolicy)
        ? "visible"
        : "internal",
      reasonCodes,
    };
  }

  // Agent execute on shared-scope repair: visible plan + checklist seed
  // when the window can afford the extra prompt and turn.
  if (
    mode === "agent" &&
    route === "execute" &&
    isBroadSharedScopeRepair({
      primaryTaskIntent: primary,
      taskAnalysis,
      message,
    })
  ) {
    if (isChangeImpactAffordable(params.windowPolicy)) {
      reasonCodes.push("change_impact_recommended");
    }
    if (isVisiblePlanAffordable(params.windowPolicy)) {
      reasonCodes.push("broad_repair_visible_plan");
      return { planningDepth: "visible", reasonCodes };
    }
    reasonCodes.push("multi_file_internal_plan");
    return { planningDepth: "internal", reasonCodes };
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
  return false;
}

function isVisiblePlanAffordable(windowPolicy?: WindowPolicy): boolean {
  return windowPolicy?.planning.visiblePlanAffordable !== false;
}

function isChangeImpactAffordable(windowPolicy?: WindowPolicy): boolean {
  return windowPolicy?.planning.changeImpactAffordable !== false;
}
