export const EMBEDDING_SCHEMA_VERSION =
  1 as const;

export const EMBEDDING_IDS = {
  GENERATOR:
    "embedding-generator",
  VECTOR_VALIDATOR:
    "embedding-vector-validator",
  TEXT_PREPARER:
    "embedding-text-preparer",
  CHANGE_PLANNER:
    "embedding-change-planner",
  SYNCHRONIZER:
    "embedding-synchronizer",
  DETERMINISTIC_TEST_PROVIDER:
    "deterministic-test-provider",
} as const;

export const EMBEDDING_DEFAULTS = {
  BATCH_SIZE:
    32,

  MAXIMUM_BATCH_SIZE:
    256,

  MAXIMUM_INPUT_CHARACTERS:
    8_000,

  MAXIMUM_ALLOWED_INPUT_CHARACTERS:
    100_000,

  INCLUDE_TITLE:
    true,

  NORMALIZE_VECTORS:
    true,

  MAXIMUM_CHANGES_PER_BATCH:
    500,

  MAXIMUM_ALLOWED_CHANGES_PER_BATCH:
    10_000,

  MAXIMUM_BATCHES_PER_RUN:
    100,

  MAXIMUM_ALLOWED_BATCHES_PER_RUN:
    10_000,

  ZERO_NORM_TOLERANCE:
    1e-12,

  UNIT_NORM_TOLERANCE:
    1e-5,
} as const;

export const EMBEDDING_LIMITS = {
  MINIMUM_DIMENSIONS:
    1,

  MAXIMUM_DIMENSIONS:
    65_536,

  MAXIMUM_PROFILE_ID_CHARACTERS:
    160,

  MAXIMUM_PROVIDER_ID_CHARACTERS:
    120,

  MAXIMUM_MODEL_ID_CHARACTERS:
    200,
} as const;

export const EMBEDDING_PATTERNS = {
  PROFILE_ID:
    /^[a-zA-Z0-9][a-zA-Z0-9._:@/+~-]*$/,

  CONTENT_HASH:
    /^[a-f0-9]{16,128}$/,
} as const;

export const EMBEDDING_MESSAGES = {
  INPUT_TRUNCATED:
    "Chunk text exceeded the embedding input limit and was truncated.",

  MISSING_UPSERT_CHUNK:
    "An upsert change referenced a chunk that is no longer present; the vector is deleted instead.",

  BATCH_LIMIT_REACHED:
    "The synchronization batch limit was reached before the Text Index revision was fully consumed.",
} as const;

export const EMBEDDING_TEXT_FORMAT = {
  TITLE_PREFIX:
    "Symbol: ",

  TITLE_SEPARATOR:
    "\n\n",
} as const;
