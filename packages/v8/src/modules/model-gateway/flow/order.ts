/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-resolve-capabilities",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
