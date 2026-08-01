export const VECTOR_INDEX_SCHEMA_VERSION =
  1 as const;

export const VECTOR_INDEX_IDS = {
  SEARCH_SERVICE:
    "vector-search-service",
  SEARCH_NORMALIZER:
    "vector-search-request-normalizer",
  LANCEDB_READER:
    "lancedb-vector-index-reader",
  LANCEDB_WRITER:
    "lancedb-vector-index-writer",
  LANCEDB_FACTORY:
    "lancedb-vector-index-factory",
  LANCEDB_TABLE_MANAGER:
    "lancedb-vector-index-table-manager",
  LANCEDB_ROW_MAPPER:
    "lancedb-vector-index-row-mapper",
  LANCEDB_FILTER_BUILDER:
    "lancedb-vector-index-filter-builder",
} as const;

export const VECTOR_INDEX_DEFAULTS = {
  MAXIMUM_RESULTS:
    20,
  MINIMUM_SCORE:
    0,
  CANDIDATE_MULTIPLIER:
    3,
  NPROBES:
    20,
  REFINE_FACTOR:
    10,
  TABLE_NAME_PREFIX:
    "v8_vectors",
} as const;

export const VECTOR_INDEX_LIMITS = {
  MAXIMUM_RESULTS:
    1_000,
  MAXIMUM_FILTER_VALUES:
    1_000,
  MAXIMUM_CANDIDATE_MULTIPLIER:
    10,
  MAXIMUM_NPROBES:
    1_024,
  MAXIMUM_REFINE_FACTOR:
    1_000,
  MAXIMUM_TABLE_NAME_PREFIX_CHARACTERS:
    40,
  UNIT_NORM_TOLERANCE:
    1e-4,
  ZERO_NORM_TOLERANCE:
    1e-12,
} as const;

export const VECTOR_INDEX_PATTERNS = {
  TABLE_NAME_PREFIX:
    /^[a-z][a-z0-9_]*$/,
  CONTENT_HASH:
    /^[a-f0-9]{16,128}$/,
} as const;

export const VECTOR_INDEX_LANCEDB = {
  VECTOR_COLUMN:
    "vector",
  DISTANCE_COLUMN:
    "_distance",
  MERGE_KEY_COLUMN:
    "record_key",
  STATE_ROW_TYPE:
    "state",
  VECTOR_ROW_TYPE:
    "vector",
  STATE_KIND:
    "state",
  RECORD_KEY_SEPARATOR:
    "|",
  TABLE_HASH_OFFSET_BASIS:
    0x811c9dc5,
  TABLE_HASH_PRIME:
    0x01000193,
  TABLE_HASH_RADIX:
    16,
  TABLE_HASH_LENGTH:
    8,
  CREATE_MODE:
    "create",
  SEARCH_COLUMNS: [
    "chunk_id",
    "root_id",
    "relative_path",
    "kind",
    "ordinal",
    "content_hash",
    "token_estimate",
    "start_line",
    "end_line",
    "title",
    "symbol_local_id",
    "profile_id",
    "_distance",
  ],
  STATE_COLUMNS: [
    "workspace",
    "root_id",
    "profile_id",
    "provider_id",
    "model_id",
    "dimensions",
    "normalized",
    "text_revision",
    "updated_at",
  ],
  PROFILE_COLUMNS: [
    "profile_id",
    "dimensions",
  ],
} as const;

export const VECTOR_INDEX_COLUMNS = {
  RECORD_KEY:
    "record_key",
  ROW_TYPE:
    "row_type",
  WORKSPACE:
    "workspace",
  ROOT_ID:
    "root_id",
  PROFILE_ID:
    "profile_id",
  PROVIDER_ID:
    "provider_id",
  MODEL_ID:
    "model_id",
  DIMENSIONS:
    "dimensions",
  NORMALIZED:
    "normalized",
  CHUNK_ID:
    "chunk_id",
  RELATIVE_PATH:
    "relative_path",
  KIND:
    "kind",
  ORDINAL:
    "ordinal",
  CONTENT_HASH:
    "content_hash",
  TOKEN_ESTIMATE:
    "token_estimate",
  START_LINE:
    "start_line",
  END_LINE:
    "end_line",
  TITLE:
    "title",
  SYMBOL_LOCAL_ID:
    "symbol_local_id",
  ACTIVE:
    "active",
  TEXT_REVISION:
    "text_revision",
  UPDATED_AT:
    "updated_at",
  VECTOR:
    "vector",
  DISTANCE:
    "_distance",
} as const;

export const VECTOR_INDEX_MESSAGES = {
  CANCELLED:
    "Vector Index operation was cancelled.",
  QUERY_DIMENSION_MISMATCH:
    "The query vector dimensions do not match the embedding profile.",
  QUERY_VECTOR_NOT_FINITE:
    "The query vector must contain only finite numbers.",
  QUERY_VECTOR_ZERO_NORM:
    "The query vector must have a non-zero norm.",
  QUERY_VECTOR_NOT_NORMALIZED:
    "The query vector must be L2-normalized for this embedding profile.",
  PROFILE_ID_MISMATCH:
    "The batch profile ID does not match the batch locator.",
  RECORD_PROFILE_MISMATCH:
    "An embedding record belongs to a different profile.",
  RECORD_ROOT_MISMATCH:
    "An embedding record belongs to a different workspace root.",
  REVISION_MISMATCH:
    "The Vector Index Text Index revision does not match the expected revision.",
  REVISION_REGRESSION:
    "The next Text Index revision cannot be lower than the expected revision.",
  TABLE_PROFILE_MISMATCH:
    "The LanceDB table belongs to a different embedding profile.",
  TABLE_DIMENSION_MISMATCH:
    "The LanceDB table vector dimensions do not match the embedding profile.",
  INVALID_LANCEDB_ROW:
    "LanceDB returned an invalid Vector Index row.",
} as const;
