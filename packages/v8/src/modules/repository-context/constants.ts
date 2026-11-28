export const REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION = 1 as const;

export const REPOSITORY_CONTEXT_PIPELINE_IDS = {
  PIPELINE: "repository-context-pipeline",
} as const;

export const REPOSITORY_CONTEXT_PIPELINE_LIMITS = {
  MAXIMUM_QUERY_CHARACTERS: 32_000,
  MAXIMUM_ROOT_IDS: 1_000,
  MAXIMUM_FILE_PATHS: 10_000,
  MAXIMUM_WARNINGS: 20_000,
} as const;

export const REPOSITORY_CONTEXT_PIPELINE_MESSAGES = {
  UNKNOWN_STATE_TOKEN:
    "No published repository state matches the supplied state reference.",
  WORKSPACE_MISMATCH:
    "State token does not belong to the requested workspace.",
  STATE_UNAVAILABLE:
    "Published repository state is unavailable for context retrieval.",
  STATE_DEGRADED:
    "Published repository state is degraded; retrieval proceeds with reduced confidence.",
} as const;

/** Named reason-code accessors for pipeline stage logs. */
export const REPOSITORY_CONTEXT_REASON = {
  stateResolved: "state_resolved",
  stateFailed: "state_failed",
  complete: "complete",
  partial: "partial",
  empty: "empty",
  failed: "failed",
  cancelled: "cancelled",
} as const;

/** Ordered flow stage names (pipeline + logger). */
export const REPOSITORY_CONTEXT_STAGES = {
  resolveState: "1-resolve-state",
  prepareRetrieval: "2-prepare-retrieval",
  retrieve: "3-retrieve",
  select: "4-select",
  assemble: "5-assemble",
  finalizeResult: "6-finalize-result",
} as const;

export type RepositoryContextStageName =
  (typeof REPOSITORY_CONTEXT_STAGES)[keyof typeof REPOSITORY_CONTEXT_STAGES];
