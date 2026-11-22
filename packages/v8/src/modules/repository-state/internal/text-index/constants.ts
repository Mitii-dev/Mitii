export const TEXT_INDEX_SCHEMA_VERSION =
  3 as const;

export const TEXT_INDEX_IDS = {
  QUERY_NORMALIZER:
    "text-query-normalizer",
  SEARCH_SERVICE:
    "text-search-service",
  SQLITE_READER:
    "sqlite-text-index-reader",
  SQLITE_WRITER:
    "sqlite-text-index-writer",
  SQLITE_MIGRATION:
    "sqlite-text-index-migration",
} as const;

export const TEXT_INDEX_DEFAULTS = {
  PIPELINE_VERSION:
    "chunking-v3-collapse-trigram",

  SEARCH_MODE:
    "any" as const,

  PREFIX_MATCHING:
    true,

  MAXIMUM_RESULTS:
    20,

  MAXIMUM_ALLOWED_RESULTS:
    200,

  SNIPPET_TOKEN_COUNT:
    32,

  MAXIMUM_SNIPPET_TOKEN_COUNT:
    128,

  MAXIMUM_QUERY_CHARACTERS:
    512,

  MAXIMUM_QUERY_TERMS:
    24,

  MINIMUM_TERM_CHARACTERS:
    3,

  MAXIMUM_FILTER_VALUES:
    100,

  MAXIMUM_CHUNK_QUERY_SIZE:
    2_500,

  SQL_BATCH_SIZE:
    400,

  MINIMUM_NORMALIZED_SCORE:
    0.1,
} as const;

export const TEXT_INDEX_PATTERNS = {
  CONTENT_HASH:
    /^[a-f0-9]{16,128}$/,

  QUERY_TERM:
    /[\p{L}\p{N}_$-]+/gu,
} as const;

export const TEXT_INDEX_TABLES = {
  DOCUMENTS:
    "text_index_documents",
  CHUNKS:
    "text_index_chunks",
  FTS:
    "text_index_fts",
  FTS_TRIGRAM:
    "text_index_fts_trigram",
  METADATA:
    "text_index_metadata",
  CHANGES:
    "text_index_changes",
} as const;

export { TEXT_INDEX_SQL } from "./constantsSql";

export const TEXT_INDEX_FTS = {
  SNIPPET_OPEN:
    "[[",
  SNIPPET_CLOSE:
    "]]",
  SNIPPET_ELLIPSIS:
    " … ",
  CONTENT_COLUMN_INDEX:
    6,

  BM25_WEIGHTS: [
    0,
    0,
    0,
    // relative_path — Continue-style path-weighted BM25 (was 2.5)
    10,
    0,
    4,
    1,
  ] as const,
} as const;

export const TEXT_INDEX_MESSAGES = {
  QUERY_TRUNCATED:
    "The search query exceeded the configured character limit and was truncated.",

  TERMS_TRUNCATED:
    "The search query contained more terms than the configured limit.",

  TERMS_REMOVED:
    "Some query fragments were removed because they were too short or unsupported.",

  DUPLICATE_FILTER_REMOVED:
    "Duplicate search filter values were removed.",

  NOT_INDEXABLE:
    "The chunking result is not safe to persist; the previous text index document was preserved.",
} as const;

export const TEXT_INDEX_ERRORS = {
  WORKSPACE_REQUIRED:
    "workspace must be a non-empty string.",

  SNAPSHOT_REQUIRED:
    "workspaceSnapshotId must be a non-empty string.",

  INVALID_TIMESTAMP:
    "indexedAt and changedAt must be non-negative safe integers.",

  DOCUMENT_NOT_INDEXABLE:
    "Only complete, partial, or empty chunking results can be mapped to a Text Index document.",

  ABORTED:
    "Text Index operation was aborted.",

  POSITIVE_INTEGER_REQUIRED:
    "Expected a positive safe integer.",

  NON_NEGATIVE_INTEGER_REQUIRED:
    "Expected a non-negative safe integer.",
} as const;
