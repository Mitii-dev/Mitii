import { PLANNING_SCHEMA_VERSION } from "../../constants";
import { planningResultSchema } from "../../contracts";
import type { PlanningReasonCode, PlanningResult } from "../../contracts";
import type { PlanFlowState } from "../types";

export function finalizeResultStep(params: {
  state: PlanFlowState;
  startedMs: number;
}): PlanningResult {
  const { state, startedMs } = params;

  const reasonCodes = unique([
    ...(state.blocked ? [] : (["plan_drafted"] as const)),
    ...state.strategyReasonCodes,
    ...state.draftReasonCodes,
  ]);

  if (state.blocked) {
    return planningResultSchema.parse({
      schemaVersion: PLANNING_SCHEMA_VERSION,
      status: "blocked",
      warnings: [...state.strategyWarnings, ...state.draftWarnings],
      reasonCodes,
      usedTokens: 0,
      budgetTokens: state.parsed.budgetTokens,
      durationMs: Date.now() - startedMs,
      strategy: state.strategyDecision,
      ...(state.clarifyDraft ? { clarifyDraft: state.clarifyDraft } : {}),
    });
  }

  return planningResultSchema.parse({
    schemaVersion: PLANNING_SCHEMA_VERSION,
    status: state.status ?? "validated",
    plan: state.drafted,
    warnings: [...state.strategyWarnings, ...state.draftWarnings],
    reasonCodes,
    usedTokens: state.usedTokens ?? 0,
    budgetTokens: state.parsed.budgetTokens,
    durationMs: Date.now() - startedMs,
    strategy: state.strategyDecision,
    ...(state.clarifyDraft ? { clarifyDraft: state.clarifyDraft } : {}),
  });
}

function unique(codes: readonly PlanningReasonCode[]): PlanningReasonCode[] {
  return [...new Set(codes)];
}
