/**
 * Stable identifiers for Verification.
 */
export const VERIFICATION_SCHEMA_VERSION = 1 as const;

export const VERIFICATION_STATUSES = [
  "verified_success",
  "implemented_unverified",
  "verification_failed",
  "blocked",
  "cancelled",
] as const;

export const VERIFICATION_CHECK_KINDS = [
  "syntax",
  "diagnostics",
  "typecheck",
  "lint",
  "format",
  "test",
  "build",
  "diff_review",
] as const;

export const VERIFICATION_CHECK_OUTCOMES = [
  "passed",
  "failed",
  "skipped",
  "unavailable",
  "timed_out",
  "cancelled",
] as const;

export const VERIFICATION_CHANGE_SCOPES = [
  "localized",
  "module",
  "cross_cutting",
  "public_api",
] as const;

export const VERIFICATION_DIAGNOSTIC_SEVERITIES = [
  "error",
  "warning",
  "info",
  "hint",
] as const;

export const VERIFICATION_REASON_CODES = [
  "verification_not_required",
  "checks_passed",
  "checks_failed",
  "checks_unavailable",
  "checks_timed_out",
  "no_applicable_checks",
  "stale_state_risk",
  "state_unavailable",
  "grant_insufficient",
  "narrow_scope_selected",
  "expanded_scope_selected",
  "diff_reviewed",
  "cancelled",
  "missing_tool_degraded",
  /** Project-local typecheck/build proved the ask; residuals are non-blocking. */
  "task_relevant_evidence_passed",
  /** Failed test/runner output was harness/denied-path noise only. */
  "residual_harness_noise",
  /** Secondary syntax/config phantoms contradicted by authoritative compile. */
  "residual_phantom_secondary",
  /** Workspace-root compile/test leftovers after package-local evidence passed. */
  "residual_workspace_root_noise",
] as const;

export const VERIFICATION_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "execution_failed",
  "store_failed",
] as const;

export const VERIFICATION_RECORD_SCHEMA_VERSION = 1 as const;

export const VERIFICATION_RECORD_STATUSES = [
  "captured_before",
  "compared",
  "passed",
  "incomplete",
  "cancelled",
] as const;

export const VERIFICATION_RECORD_REASON_CODES = [
  "record_captured_before",
  "record_compared",
  "record_passed",
  "record_incomplete",
  "record_cancelled",
  "retry_available",
] as const;

export type VerificationReasonCodeConst =
  (typeof VERIFICATION_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const VERIFICATION_REASON = {
  notRequired: "verification_not_required",
  checksPassed: "checks_passed",
  checksFailed: "checks_failed",
  checksUnavailable: "checks_unavailable",
  checksTimedOut: "checks_timed_out",
  noApplicableChecks: "no_applicable_checks",
  staleStateRisk: "stale_state_risk",
  stateUnavailable: "state_unavailable",
  grantInsufficient: "grant_insufficient",
  narrowScopeSelected: "narrow_scope_selected",
  expandedScopeSelected: "expanded_scope_selected",
  diffReviewed: "diff_reviewed",
  cancelled: "cancelled",
  missingToolDegraded: "missing_tool_degraded",
  taskRelevantEvidencePassed: "task_relevant_evidence_passed",
  residualHarnessNoise: "residual_harness_noise",
  residualPhantomSecondary: "residual_phantom_secondary",
  residualWorkspaceRootNoise: "residual_workspace_root_noise",
} as const satisfies Record<string, VerificationReasonCodeConst>;

export const VERIFICATION_MESSAGES = {
  inputInvalid: "Verification input failed schema validation.",
  portsRequired: "VerificationPipeline requires tools and manifests ports.",
  storeFailed: "Failed to persist the verification record.",
  stateUnavailable: "Pinned repository state is unavailable.",
  notRequired: "Verification was not required by Decision Policy.",
  omittedChecks: (count: number) =>
    `Omitted ${count} lower-priority check candidate(s) for proportional scope.`,
  failedWithoutDiagnostics: (count: number, ids: string) =>
    `${count} check(s) failed but no diagnostics could be parsed from their output: ${ids}.`,
} as const;

/** Ordered flow stage names (pipeline + logger). */
export const VERIFICATION_STAGES = {
  mapAffectedProjects: "1-map-affected-projects",
  discoverChecks: "2-discover-checks",
  selectChecks: "3-select-checks",
  executeChecks: "4-execute-checks",
  normalizeDiagnostics: "5-normalize-diagnostics",
  inspectDiff: "6-inspect-diff",
  recommendCompletion: "7-recommend-completion",
  captureBuildState: "8-capture-build-state",
  buildRecord: "9-build-record",
  buildUserSummary: "10-build-user-summary",
} as const;

export type VerificationStageName =
  (typeof VERIFICATION_STAGES)[keyof typeof VERIFICATION_STAGES];

