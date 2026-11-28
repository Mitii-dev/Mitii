/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-select-files",
  "2-group-files",
  "3-resolve-rules",
  "4-repair-findings",
  "5-anchor-findings",
  "6-reflect-findings",
  "7-build-record",
  "8-export-sarif",
  "9-format-prep",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
