import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";
import { AGENT_ENGINE_THRESHOLDS } from "../policy";

export type ReasoningProgressBudget = {
  /** Soft cap for turns that may not stream a reasoning channel. */
  baseChars: number;
  /**
   * Once a reasoning_delta arrives (or the model advertises reasoning),
   * shrink the in-turn cap to this value so thinking-only burns recover
   * into tools sooner — even when capabilities.supportsReasoning is false.
   */
  tightChars: number;
};

/**
 * Reasoning-progress abort budgets. Capability flag or prior observed
 * reasoning both select the tight starting budget; otherwise the base
 * starts high and consumeModelTurn shrinks mid-turn on first reasoning_delta.
 */
export function resolveReasoningProgressBudget(params: {
  thresholds?: Pick<
    AgentEngineThresholds,
    | "maxReasoningCharsWithoutProgress"
    | "reasoningProgressBudgetRatioWhenReasoningCapable"
  >;
  supportsReasoning?: boolean;
  /** Prior turns already streamed a reasoning channel this run. */
  observedReasoningChannel?: boolean;
}): ReasoningProgressBudget {
  const thresholds = params.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  const base = thresholds.maxReasoningCharsWithoutProgress;
  const ratio = thresholds.reasoningProgressBudgetRatioWhenReasoningCapable;
  const tight = Math.max(2_000, Math.floor(base * ratio));
  const preferTight =
    params.supportsReasoning === true ||
    params.observedReasoningChannel === true;
  return {
    baseChars: preferTight ? tight : base,
    tightChars: tight,
  };
}

/** @deprecated Prefer {@link resolveReasoningProgressBudget}.baseChars */
export function resolveReasoningProgressBudgetChars(params: {
  thresholds?: Pick<
    AgentEngineThresholds,
    | "maxReasoningCharsWithoutProgress"
    | "reasoningProgressBudgetRatioWhenReasoningCapable"
  >;
  supportsReasoning?: boolean;
  observedReasoningChannel?: boolean;
}): number {
  return resolveReasoningProgressBudget(params).baseChars;
}

/**
 * Whether to nudge toward granted code-intelligence tools after many file
 * reads with no symbol/nav tool use yet.
 */
export function shouldNudgeCodeIntelAdoption(params: {
  allowedTools: readonly string[];
  codeIntelligenceToolIds: readonly string[];
  successfulFileBodyReads: number;
  codeIntelToolUses: number;
  nudgesUsed: number;
  thresholds?: Pick<
    AgentEngineThresholds,
    "maxFileReadsBeforeCodeIntelNudge" | "maxCodeIntelAdoptionNudges"
  >;
}): boolean {
  const thresholds = params.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  if (thresholds.maxCodeIntelAdoptionNudges <= 0) {
    return false;
  }
  if (params.nudgesUsed >= thresholds.maxCodeIntelAdoptionNudges) {
    return false;
  }
  if (params.codeIntelToolUses > 0) {
    return false;
  }
  if (
    params.successfulFileBodyReads < thresholds.maxFileReadsBeforeCodeIntelNudge
  ) {
    return false;
  }
  return params.codeIntelligenceToolIds.some((id) =>
    params.allowedTools.includes(id),
  );
}

export function buildCodeIntelAdoptionNudgeMessage(
  grantedCodeIntelTools: readonly string[],
): string {
  const examples = grantedCodeIntelTools.slice(0, 4).join(", ");
  return [
    "You have been reading file bodies without using granted code-intelligence tools.",
    `Before more mass read_file / search_files, call one of: ${examples || "document_symbol, goto_definition"}.`,
    "Use symbol tools to locate types, call sites, and implementations, then continue with a focused patch or read.",
  ].join("\n");
}
