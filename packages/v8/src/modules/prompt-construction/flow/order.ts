/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-allocate-budget",
  "2-assemble-system",
  "3-assemble-tools",
  "4-assemble-conversation",
  "5-assemble-user-request",
  "6-resolve-dynamic-output",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
