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

/**
 * Skill playbook / task-breakdown methodology lines.
 * These may bias planning behavior but must not become executable plan steps.
 * Keep generic — no host, language, or repo names.
 */
export const PLANNING_PROCESS_META_STEP =
  /restate the goal|constraints from the spec|identify dependencies and risky areas|produce ordered tasks|with acceptance criteria|small enough to verify independently|clear done check|order respects dependencies|you have a spec|task feels too large|when not to use|do not write code during planning|operate in read-only mode|need to be parallelized|communicate scope to a human|implementable units|break (?:it|the (?:task|work)|this) (?:down|into)/i;
