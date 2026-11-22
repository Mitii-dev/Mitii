import type { AgentMode } from "../../../request-intake";

import { INTENT_CONSTANTS } from "../constants";
import type { IntentClassification, InteractionIntent } from "../schema";
import type { TaskIntent } from "../types";

export function isActionableTaskIntent(intent: TaskIntent): boolean {
  switch (intent) {
    case "bugfix":
    case "feature":
    case "refactor":
    case "optimize":
    case "test":
    case "security":
    case "scaffold":
    case "migrate":
    case "schema":
    case "mock":
    case "config":
    case "dependency":
    case "docs":
    case "style":
    case "format":
      return true;

    default:
      return false;
  }
}

export function applyModePolicy(
  mode: AgentMode,
  interactionIntent: InteractionIntent,
): InteractionIntent {
  if (mode === "ask") {
    return "question";
  }

  if (mode === "plan") {
    return "plan";
  }

  return interactionIntent;
}

export function resolveInteractionIntent({
  mode,
  ruleInteraction,
  llmInteraction,
  llmPrimaryIntent,
  llmConfidence,
}: {
  mode: AgentMode;
  ruleInteraction?: InteractionIntent;
  llmInteraction: InteractionIntent;
  llmPrimaryIntent: TaskIntent;
  llmConfidence: number;
}): InteractionIntent {
  if (mode === "ask") {
    return "question";
  }

  if (mode === "plan") {
    return "plan";
  }

  if (!ruleInteraction || ruleInteraction === llmInteraction) {
    return llmInteraction;
  }

  if (
    llmInteraction === "act" &&
    llmConfidence >= INTENT_CONSTANTS.HIGH_CONFIDENCE &&
    isActionableTaskIntent(llmPrimaryIntent)
  ) {
    // ≥70% LLM act beats a conflicting rule "question" (and similar).
    return "act";
  }

  /*
   * Below HIGH_CONFIDENCE, keep ambiguous read/write conflicts read-only.
   */
  if (ruleInteraction === "question" || llmInteraction === "question") {
    return "question";
  }

  if (ruleInteraction === "plan" || llmInteraction === "plan") {
    return "plan";
  }

  return "act";
}

export function acceptsHighConfidenceLlmAction({
  interactionIntent,
  llmClassification,
}: {
  interactionIntent: InteractionIntent;
  llmClassification: IntentClassification;
}): boolean {
  return (
    interactionIntent === "act" &&
    llmClassification.interactionIntent === "act" &&
    llmClassification.confidence >= INTENT_CONSTANTS.HIGH_CONFIDENCE &&
    isActionableTaskIntent(llmClassification.primaryTaskIntent)
  );
}
