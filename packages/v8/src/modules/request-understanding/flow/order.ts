/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-extract-messages",
  "2-build-evidence",
  "3-classify-intent",
  "4-analyze-task",
  "5-finalize-result",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
