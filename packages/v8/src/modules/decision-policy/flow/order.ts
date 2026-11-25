/** Single source of flow step order for decide(). Pipeline must follow this list. */
export const FLOW_ORDER = [
  "1-scan-injection",
  "2-plan-route",
  "3-compile-grant",
  "4-clamp-injection",
  "5-intersect-safety",
  "6-resolve-context",
  "7-finalize-decision",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];
