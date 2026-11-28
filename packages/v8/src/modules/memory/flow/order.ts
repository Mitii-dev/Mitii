/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-filter-candidates",
  "2-score-relevance",
  "3-apply-budget",
  "4-prepare-commit",
  "5-commit-and-consolidate",
  "6-build-synthetic-draft",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
