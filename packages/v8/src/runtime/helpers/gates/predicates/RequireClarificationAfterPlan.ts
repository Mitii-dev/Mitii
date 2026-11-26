import type { GateVerdict } from "../kinds";
import type { GateContext } from "../types";

/**
 * after_plan: scope fork / hollow plan → clarify.
 * Pure flags only — port of plan-discovery shouldSuspendForPlanScopeFork.
 */
export function shouldSuspendForPlanScopeFork(params: {
  mode?: GateContext["mode"];
  strategy?: string;
  hasClarifyDraft: boolean;
  scopeChoiceResolved: boolean;
  qualityFloor: boolean;
  forceCampaignPhaseLock?: boolean;
  askNeedsScopeFork?: boolean;
}): boolean {
  if (params.scopeChoiceResolved) return false;
  if (params.askNeedsScopeFork === false) return false;
  if (!params.hasClarifyDraft) return false;
  if (params.strategy === "clarify") {
    if (params.mode === "plan") return true;
    return params.mode === "agent" && params.qualityFloor;
  }
  if (
    params.askNeedsScopeFork === true &&
    params.forceCampaignPhaseLock &&
    params.mode === "agent" &&
    params.qualityFloor
  ) {
    return true;
  }
  return false;
}

/** Visible Agent campaign lock — only for true multi-outcome forks. */
export function shouldForceCampaignPhaseLock(params: {
  mode?: GateContext["mode"];
  planningDepth?: string;
  changeStepCount?: number;
  qualityFloor: boolean;
  askNeedsScopeFork?: boolean;
}): boolean {
  if (params.mode !== "agent" || !params.qualityFloor) return false;
  if (params.askNeedsScopeFork !== true) return false;
  if (params.planningDepth === "visible") return true;
  return (params.changeStepCount ?? 0) >= 5;
}

export function requireClarificationAfterPlan(
  ctx: GateContext,
): GateVerdict | undefined {
  if (ctx.hollowPlan) {
    return {
      action: "suspend",
      kind: "clarification_required",
      payload: { clarifyOrigin: "hollow_plan" },
      reasonCodes: ["gate_clarify_hollow_plan"],
    };
  }

  const fork = shouldSuspendForPlanScopeFork({
    mode: ctx.mode,
    strategy: ctx.planStrategy,
    hasClarifyDraft: ctx.hasClarifyDraft === true,
    scopeChoiceResolved: ctx.scopeChoiceResolved === true,
    qualityFloor: ctx.qualityFloor === true,
    forceCampaignPhaseLock: ctx.forceCampaignPhaseLock,
    askNeedsScopeFork: ctx.askNeedsScopeFork,
  });

  if (!fork) return undefined;

  return {
    action: "suspend",
    kind: "clarification_required",
    payload: { clarifyOrigin: "scope_fork" },
    reasonCodes: ["gate_clarify_scope_fork"],
  };
}
