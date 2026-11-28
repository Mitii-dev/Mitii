/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-map-affected-projects",
  "2-discover-checks",
  "3-select-checks",
  "4-execute-checks",
  "5-normalize-diagnostics",
  "6-inspect-diff",
  "7-recommend-completion",
  "8-capture-build-state",
  "9-build-record",
  "10-build-user-summary",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
