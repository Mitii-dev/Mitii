/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-resolve-required",
  "10-format-prompt-content",
  "2-resolve-preferred",
  "3-match-skills",
  "4-merge-candidates",
  "5-resolve-conflicts",
  "6-apply-budget",
  "7-parse-mentions",
  "8-map-understanding-evidence",
  "9-derive-repo-evidence",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
