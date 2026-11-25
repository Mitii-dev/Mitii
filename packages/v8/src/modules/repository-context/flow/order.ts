/** Single source of flow step order. Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-resolve-state",
  "2-prepare-retrieval",
  "3-retrieve",
  "4-select",
  "5-assemble",
  "6-finalize-result",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
