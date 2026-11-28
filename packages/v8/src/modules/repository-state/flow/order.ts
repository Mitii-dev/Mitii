/** Single source of flow step order for publish(). Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-parse-candidate",
  "2-build-descriptor",
  "3-persist-descriptor",
  "4-finalize-publish",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
