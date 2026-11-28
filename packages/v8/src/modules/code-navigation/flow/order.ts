/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-resolve-port",
  "2-prepare-document",
  "3-execute-operation",
  "4-build-result",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
