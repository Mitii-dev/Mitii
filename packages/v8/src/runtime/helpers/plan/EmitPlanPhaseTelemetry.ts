/**
 * S3A-TELEMETRY — structured stage log for plan-phase budgets (§6.5).
 * Pure record; hosts/event sinks may forward.
 */

import type { DiscoveryPassBudget } from "../../../modules/window-budget";

export interface PlanPhaseTelemetry {
  stage: "plan_phase";
  band?: string;
  contextWindowTokens?: number;
  discoveryBudget?: DiscoveryPassBudget;
  planBudget?: {
    maxModelCalls?: number;
    maxToolCalls?: number;
  };
  executeBudget?: {
    maxModelCalls?: number;
    maxToolCalls?: number;
  };
  grantBudget?: {
    maxToolCalls?: number;
  };
  planTokensUsed?: number;
  discoveryRan?: boolean;
  discoveryQualityOk?: boolean;
  reasonCodes: string[];
}

export function emitPlanPhaseTelemetry(input: {
  band?: string;
  contextWindowTokens?: number;
  discoveryBudget?: DiscoveryPassBudget;
  planBudget?: PlanPhaseTelemetry["planBudget"];
  executeBudget?: PlanPhaseTelemetry["executeBudget"];
  grantMaxToolCalls?: number;
  planTokensUsed?: number;
  discoveryRan?: boolean;
  discoveryQualityOk?: boolean;
  extraReasonCodes?: readonly string[];
}): PlanPhaseTelemetry {
  return {
    stage: "plan_phase",
    band: input.band,
    contextWindowTokens: input.contextWindowTokens,
    discoveryBudget: input.discoveryBudget,
    planBudget: input.planBudget,
    executeBudget: input.executeBudget,
    ...(input.grantMaxToolCalls != null
      ? { grantBudget: { maxToolCalls: input.grantMaxToolCalls } }
      : {}),
    planTokensUsed: input.planTokensUsed,
    discoveryRan: input.discoveryRan,
    discoveryQualityOk: input.discoveryQualityOk,
    reasonCodes: [
      "plan_telemetry_emitted",
      ...(input.band ? [`telemetry_band_${input.band}`] : []),
      ...(input.extraReasonCodes ?? []),
    ],
  };
}
