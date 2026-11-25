/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-assess-graph",
  "10-merge-navigation-enrichment",
  "11-compact-model-facing",
  "12-recommend-widen",
  "2-resolve-seeds",
  "3-walk-impact",
  "4-apply-coupling-cycles",
  "5-finalize-result",
  "6-analyze-many",
  "7-merge-results",
  "8-evaluate-spillover",
  "9-plan-check",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
