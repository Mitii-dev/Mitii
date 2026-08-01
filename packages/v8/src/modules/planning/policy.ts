/**
 * Planning thresholds — dimension-driven, not plan-type-driven.
 */
export const PLANNING_THRESHOLDS = {
  /** Risk at or above this forces approvalRequired on the artifact. */
  approvalRiskFloor: "high" as const,
  /** Scope at or above this prefers discovery-first phases. */
  discoveryScopeFloor: "package" as const,
  /** Complexity at or above this prefers multi-phase plans. */
  multiPhaseComplexityFloor: "moderate" as const,
} as const;
