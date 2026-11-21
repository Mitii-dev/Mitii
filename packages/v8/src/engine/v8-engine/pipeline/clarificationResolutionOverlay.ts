import {
  applyClarificationFactPatch,
  type ClarificationFactPatch,
} from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import { INTENT_CONSTANTS } from "../../../modules/request-understanding";
import type { IntentClassification } from "../../../modules/request-understanding";
import type { TaskIntent } from "../../../modules/request-understanding";

import type { AgentEngineStartInput } from "../contracts";

/** Fold a structured clarification answer into the understanding result. */
export function applyClarificationResolutionOverlay(
  understanding: RequestUnderstandingResult,
  resolution: AgentEngineStartInput["clarificationResolution"],
): RequestUnderstandingResult {
  if (!resolution) {
    return understanding;
  }
  const taskIntentSet = new Set<string>(INTENT_CONSTANTS.TASK_INTENTS);
  const patch: ClarificationFactPatch = {
    optionId: resolution.optionId,
    label: resolution.label,
    interactionIntent: resolution.interactionIntent,
    targetPath: resolution.targetPath,
    scopeHint: resolution.scopeHint,
    outcomeNote: resolution.outcomeNote,
  };
  if (
    resolution.primaryTaskIntent &&
    taskIntentSet.has(resolution.primaryTaskIntent)
  ) {
    patch.primaryTaskIntent = resolution.primaryTaskIntent as TaskIntent;
  }
  const classification = applyClarificationFactPatch(
    understanding.intent.classification as IntentClassification,
    patch,
  );
  return {
    ...understanding,
    intent: {
      ...understanding.intent,
      status: "accepted",
      recommendsClarification: false,
      clarification: undefined,
      classification,
    },
  };
}
