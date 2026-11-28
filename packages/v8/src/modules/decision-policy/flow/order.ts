/** Single source of flow stage order for decide() (S2C-FLOW: 4 stages). */
export const FLOW_ORDER = [
  "1-normalize-and-guard",
  "2-resolve-route-and-gate",
  "3-compile-grant-and-fences",
  "4-emit-decision-and-trace",
] as const;

export type FlowStepId = (typeof FLOW_ORDER)[number];

/** Legacy 7-step ids kept for stage-log compat / docs. */
export const LEGACY_FLOW_ORDER = [
  "1-scan-injection",
  "2-plan-route",
  "3-compile-grant",
  "4-clamp-injection",
  "5-intersect-safety",
  "6-resolve-context",
  "7-finalize-decision",
] as const;
