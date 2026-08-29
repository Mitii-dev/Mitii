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

/**
 * discover_and_plan's single model draft call. Not a generic
 * light/full enrichment mode — strategy-specific, runs at most once.
 */
export const DISCOVERED_PLAN_POLICY = {
  maxSteps: 10,
  maxRepoEntries: 40,
  maxDiagnostics: 16,
} as const;

/**
 * Hop-1 working-set annotation for follow_evidence only.
 * Engine walks the graph; Planning only compiles these caps onto Change steps.
 */
export const PLANNING_WORKING_SET_POLICY = {
  maxMustRead: 5,
  maxAffected: 5,
  maximumHops: 1,
  maximumAffectedNodes: 5,
  maxReports: 16,
  /** Write files per diagnostic Change step. Engine may pass the window cap. */
  maxWritePerBatch: 7,
  /**
   * Diagnostic batches kept on the PlanArtifact. The live task list is
   * smaller; leftover batches stream in as earlier items complete.
   * Must stay within planPhaseSchema.steps.max (20).
   */
  maxBatchesOnPlan: 16,
  dependencyEdgeTypes: ["imports", "depends_on"] as const,
  dependentEdgeTypes: ["imports", "calls", "references"] as const,
} as const;
