/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-normalize-server-id",
  "2-parse-mentions",
  "3-merge-server-ids",
  "4-match-tool",
  "5-filter-tools",
  "6-stamp-grant",
  "7-format-instruction",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
