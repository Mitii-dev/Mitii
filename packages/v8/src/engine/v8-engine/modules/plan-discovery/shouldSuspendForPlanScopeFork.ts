import type { AgentMode } from "../../../../modules/request-intake";
import type { PlanStrategy } from "../../../../modules/planning";

/**
 * Whether Engine should suspend with findings + A/B/C scope chips.
 *
 * - Plan/Agent clarify: only when the ask truly forks AND quality floor applies
 *   (Agent) / draft exists (Plan). Clear single-outcome features never suspend.
 * - Agent campaign: only when the ask is multi-outcome (not every visible plan).
 */
export function shouldSuspendForPlanScopeFork(params: {
  mode: AgentMode;
  strategy?: PlanStrategy | string;
  hasClarifyDraft: boolean;
  scopeChoiceResolved: boolean;
  /** Result of `requiresPlanDiscoveryQualityFloor`. */
  qualityFloor: boolean;
  /**
   * Agent visible / campaign: phase-lock even when strategy is
   * `discover_and_plan` (discovery succeeded).
   */
  forceCampaignPhaseLock?: boolean;
  /**
   * Ask truly forks across mutually exclusive scopes (not a clear feature).
   * When false, never suspend for harness A/B/C.
   */
  askNeedsScopeFork?: boolean;
}): boolean {
  if (params.scopeChoiceResolved) {
    return false;
  }
  // Explicit clear single-outcome asks never get harness A/B/C.
  if (params.askNeedsScopeFork === false) {
    return false;
  }
  if (!params.hasClarifyDraft) {
    return false;
  }
  if (params.strategy === "clarify") {
    // True clarify strategy: suspend when draft exists (undefined askNeeds =
    // fail-safe suspend; callers should still pass the boolean).
    if (params.mode === "plan") {
      return true;
    }
    return params.mode === "agent" && params.qualityFloor;
  }
  // Campaign phase-lock is opt-in: only when the ask truly forks.
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

/**
 * Visible Agent plan or a large Change checklist → campaign phase-lock
 * only when the ask is a true multi-outcome fork.
 */
export function shouldForceCampaignPhaseLock(params: {
  mode: AgentMode;
  planningDepth?: string;
  changeStepCount?: number;
  qualityFloor: boolean;
  /** When false/undefined, never campaign-lock (opt-in for true forks only). */
  askNeedsScopeFork?: boolean;
}): boolean {
  if (params.mode !== "agent" || !params.qualityFloor) {
    return false;
  }
  if (params.askNeedsScopeFork !== true) {
    return false;
  }
  if (params.planningDepth === "visible") {
    return true;
  }
  return (params.changeStepCount ?? 0) >= 5;
}
