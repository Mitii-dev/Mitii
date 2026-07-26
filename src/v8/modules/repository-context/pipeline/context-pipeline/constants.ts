export const REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION =
  1 as const;

export const REPOSITORY_CONTEXT_PIPELINE_IDS = {
  PIPELINE:
    "repository-context-pipeline",
} as const;

export const REPOSITORY_CONTEXT_PIPELINE_LIMITS = {
  MAXIMUM_QUERY_CHARACTERS:
    32_000,
  MAXIMUM_ROOT_IDS:
    1_000,
  MAXIMUM_FILE_PATHS:
    10_000,
  MAXIMUM_WARNINGS:
    20_000,
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
