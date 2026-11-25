/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-apply-update",
  "2-create-discovery",
  "3-derive-from-plan",
  "4-refill-from-plan",
  "5-serialize",
  "6-task-item-paths",
] as const;
export type FlowStepId = (typeof FLOW_ORDER)[number];
