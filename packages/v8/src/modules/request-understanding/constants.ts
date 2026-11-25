export const REQUEST_UNDERSTANDING_IDS = {
  PIPELINE: "request-understanding-pipeline",
} as const;

export const REQUEST_UNDERSTANDING_MESSAGES = {
  inputInvalid: "Request Understanding input failed schema validation.",
} as const;

/** Named reason codes for stage logs (pipeline observability). */
export const REQUEST_UNDERSTANDING_REASON = {
  messagesExtracted: "messages_extracted",
  evidenceBuilt: "evidence_built",
  intentClassified: "intent_classified",
  taskAnalyzed: "task_analyzed",
  complete: "complete",
} as const;

/** Ordered flow stage names (pipeline + logger). */
export const REQUEST_UNDERSTANDING_STAGES = {
  extractMessages: "1-extract-messages",
  buildEvidence: "2-build-evidence",
  classifyIntent: "3-classify-intent",
  analyzeTask: "4-analyze-task",
  finalizeResult: "5-finalize-result",
} as const;

export type RequestUnderstandingStageName =
  (typeof REQUEST_UNDERSTANDING_STAGES)[keyof typeof REQUEST_UNDERSTANDING_STAGES];
