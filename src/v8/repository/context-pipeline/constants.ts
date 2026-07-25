export const REPOSITORY_CONTEXT_PIPELINE_SCHEMA_VERSION =
  1 as const;

export const REPOSITORY_CONTEXT_PIPELINE_IDS = {
  PIPELINE:
    "repository-context-pipeline",
} as const;

export const REPOSITORY_CONTEXT_PIPELINE_LIMITS = {
  MAXIMUM_QUERY_CHARACTERS:
    32_000,
  MAXIMUM_WORKSPACE_CHARACTERS:
    4_096,
  MAXIMUM_ROOT_IDS:
    1_000,
  MAXIMUM_FILE_PATHS:
    10_000,
  MAXIMUM_WARNINGS:
    20_000,
} as const;

export const REPOSITORY_CONTEXT_PIPELINE_MESSAGES = {
  SNAPSHOT_MISMATCH:
    "Repository intelligence must belong to the supplied workspace snapshot.",
  CHANGE_TOKEN_MISMATCH:
    "All supplied repository intelligence must use the same Code Index change token.",
} as const;
