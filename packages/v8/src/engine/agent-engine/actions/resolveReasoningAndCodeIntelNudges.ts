import type { AgentEngineThresholds } from "./resolveAgentEngineThresholds";
import { AGENT_ENGINE_THRESHOLDS } from "../policy";

/**
 * Effective reasoning-progress abort budget. Reasoning-capable models get a
 * tighter cap so thinking-only streams recover into tools sooner.
 */
export function resolveReasoningProgressBudget(params: {
  thresholds?: Pick<
    AgentEngineThresholds,
    | "maxReasoningCharsWithoutProgress"
    | "reasoningProgressBudgetRatioWhenReasoningCapable"
  >;
  supportsReasoning?: boolean;
}): number {
  const thresholds = params.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  const base = thresholds.maxReasoningCharsWithoutProgress;
  if (params.supportsReasoning !== true) {
    return base;
  }
  const ratio = thresholds.reasoningProgressBudgetRatioWhenReasoningCapable;
  return Math.max(2_000, Math.floor(base * ratio));
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
