export const TEXT_INDEX_SCHEMA_VERSION =
  1 as const;

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
    "chunking-v1",

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
    1_000,

  SQL_BATCH_SIZE:
    400,

  MINIMUM_NORMALIZED_SCORE:
    0.1,
} as const;

export const TEXT_INDEX_PATTERNS = {
  CONTENT_HASH:
    /^[a-f0-9]{16,128}$/,

  QUERY_TERM:
    /[\p{L}\p{N}_-]+/gu,
} as const;

export const TEXT_INDEX_TABLES = {
  DOCUMENTS:
    "text_index_documents",
  CHUNKS:
    "text_index_chunks",
  FTS:
    "text_index_fts",
  METADATA:
    "text_index_metadata",
  CHANGES:
    "text_index_changes",
} as const;

export const TEXT_INDEX_SQL = {
  CREATE_SCHEMA: `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS text_index_documents (
      workspace TEXT NOT NULL,
      root_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      source_id TEXT NOT NULL,
      source_content_hash TEXT NOT NULL,
      language TEXT,
      chunking_schema_version INTEGER NOT NULL,
      pipeline_version TEXT NOT NULL,
      chunking_status TEXT NOT NULL,
      strategy_id TEXT,
      chunk_count INTEGER NOT NULL,
      snapshot_id TEXT NOT NULL,
      indexed_at INTEGER NOT NULL,
      PRIMARY KEY (workspace, root_id, relative_path)
    );

    CREATE TABLE IF NOT EXISTS text_index_chunks (
      id TEXT NOT NULL,
      workspace TEXT NOT NULL,
      root_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      source_id TEXT NOT NULL,
      strategy_id TEXT NOT NULL,
      ordinal INTEGER NOT NULL,
      kind TEXT NOT NULL,
      title TEXT,
      symbol_local_id TEXT,
      content TEXT NOT NULL,
      source_content_hash TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      token_estimate INTEGER NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      start_line INTEGER NOT NULL,
      end_line INTEGER NOT NULL,
      PRIMARY KEY (
        workspace,
        id
      ),
      UNIQUE (
        workspace,
        root_id,
        relative_path,
        ordinal
      ),
      FOREIGN KEY (
        workspace,
        root_id,
        relative_path
      )
      REFERENCES text_index_documents (
        workspace,
        root_id,
        relative_path
      )
      ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_text_index_chunks_document
      ON text_index_chunks (
        workspace,
        root_id,
        relative_path,
        ordinal
      );

    CREATE TABLE IF NOT EXISTS text_index_metadata (
      workspace TEXT NOT NULL,
      root_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      snapshot_id TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (workspace, root_id)
    );

    CREATE TABLE IF NOT EXISTS text_index_changes (
      workspace TEXT NOT NULL,
      root_id TEXT NOT NULL,
      revision INTEGER NOT NULL,
      operation TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      relative_path TEXT NOT NULL,
      changed_at INTEGER NOT NULL,
      PRIMARY KEY (
        workspace,
        root_id,
        revision,
        operation,
        chunk_id
      )
    );

    CREATE INDEX IF NOT EXISTS idx_text_index_changes_revision
      ON text_index_changes (
        workspace,
        root_id,
        revision,
        chunk_id
      );

    CREATE VIRTUAL TABLE IF NOT EXISTS text_index_fts USING fts5(
      chunk_id UNINDEXED,
      workspace UNINDEXED,
      root_id UNINDEXED,
      relative_path,
      kind UNINDEXED,
      title,
      content,
      tokenize = 'trigram'
    );

    CREATE TRIGGER IF NOT EXISTS text_index_chunks_after_insert
    AFTER INSERT ON text_index_chunks
    BEGIN
      INSERT INTO text_index_fts (
        rowid,
        chunk_id,
        workspace,
        root_id,
        relative_path,
        kind,
        title,
        content
      )
      VALUES (
        new.rowid,
        new.id,
        new.workspace,
        new.root_id,
        new.relative_path,
        new.kind,
        COALESCE(new.title, ''),
        new.content
      );
    END;

    CREATE TRIGGER IF NOT EXISTS text_index_chunks_before_delete
    BEFORE DELETE ON text_index_chunks
    BEGIN
      DELETE FROM text_index_fts
      WHERE rowid = old.rowid;
    END;

    CREATE TRIGGER IF NOT EXISTS text_index_chunks_after_update
    AFTER UPDATE ON text_index_chunks
    BEGIN
      DELETE FROM text_index_fts
      WHERE rowid = old.rowid;

      INSERT INTO text_index_fts (
        rowid,
        chunk_id,
        workspace,
        root_id,
        relative_path,
        kind,
        title,
        content
      )
      VALUES (
        new.rowid,
        new.id,
        new.workspace,
        new.root_id,
        new.relative_path,
        new.kind,
        COALESCE(new.title, ''),
        new.content
      );
    END;
  `,

  GET_DOCUMENT_STATE: `
    SELECT
      workspace AS workspace,
      root_id AS rootId,
      relative_path AS relativePath,
      source_id AS sourceId,
      source_content_hash AS sourceContentHash,
      pipeline_version AS pipelineVersion,
      chunking_status AS chunkingStatus,
      chunk_count AS chunkCount,
      snapshot_id AS workspaceSnapshotId,
      indexed_at AS indexedAt
    FROM text_index_documents
    WHERE workspace = ?
      AND root_id = ?
      AND relative_path = ?
    LIMIT 1
  `,

  UPSERT_DOCUMENT: `
    INSERT INTO text_index_documents (
      workspace,
      root_id,
      relative_path,
      source_id,
      source_content_hash,
      language,
      chunking_schema_version,
      pipeline_version,
      chunking_status,
      strategy_id,
      chunk_count,
      snapshot_id,
      indexed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (
      workspace,
      root_id,
      relative_path
    )
    DO UPDATE SET
      source_id = excluded.source_id,
      source_content_hash = excluded.source_content_hash,
      language = excluded.language,
      chunking_schema_version = excluded.chunking_schema_version,
      pipeline_version = excluded.pipeline_version,
      chunking_status = excluded.chunking_status,
      strategy_id = excluded.strategy_id,
      chunk_count = excluded.chunk_count,
      snapshot_id = excluded.snapshot_id,
      indexed_at = excluded.indexed_at
  `,

  UPDATE_DOCUMENT_METADATA: `
    UPDATE text_index_documents
    SET snapshot_id = ?, indexed_at = ?
    WHERE workspace = ?
      AND root_id = ?
      AND relative_path = ?
  `,

  GET_DOCUMENT_CHUNK_IDS: `
    SELECT
      id AS id,
      relative_path AS relativePath
    FROM text_index_chunks
    WHERE workspace = ?
      AND root_id = ?
      AND relative_path = ?
    ORDER BY ordinal
  `,

  DELETE_DOCUMENT_CHUNKS: `
    DELETE FROM text_index_chunks
    WHERE workspace = ?
      AND root_id = ?
      AND relative_path = ?
  `,

  INSERT_CHUNK: `
    INSERT INTO text_index_chunks (
      id,
      workspace,
      root_id,
      relative_path,
      source_id,
      strategy_id,
      ordinal,
      kind,
      title,
      symbol_local_id,
      content,
      source_content_hash,
      content_hash,
      token_estimate,
      start_offset,
      end_offset,
      start_line,
      end_line
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  DELETE_DOCUMENT: `
    DELETE FROM text_index_documents
    WHERE workspace = ?
      AND root_id = ?
      AND relative_path = ?
  `,

  GET_ROOT_DOCUMENT_PATHS: `
    SELECT relative_path AS relativePath
    FROM text_index_documents
    WHERE workspace = ?
      AND root_id = ?
    ORDER BY relative_path
  `,

  ENSURE_METADATA: `
    INSERT INTO text_index_metadata (
      workspace,
      root_id,
      schema_version,
      revision,
      snapshot_id,
      updated_at
    )
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT (workspace, root_id)
    DO NOTHING
  `,

  BUMP_REVISION: `
    UPDATE text_index_metadata
    SET
      revision = revision + 1,
      schema_version = ?,
      snapshot_id = ?,
      updated_at = ?
    WHERE workspace = ?
      AND root_id = ?
  `,

  GET_REVISION: `
    SELECT revision AS revision
    FROM text_index_metadata
    WHERE workspace = ?
      AND root_id = ?
    LIMIT 1
  `,

  INSERT_CHANGE: `
    INSERT INTO text_index_changes (
      workspace,
      root_id,
      revision,
      operation,
      chunk_id,
      relative_path,
      changed_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `,

  GET_CHANGES: `
    SELECT
      revision AS revision,
      operation AS kind,
      chunk_id AS chunkId,
      root_id AS rootId,
      relative_path AS relativePath,
      changed_at AS changedAt
    FROM text_index_changes
    WHERE workspace = ?
      AND root_id = ?
      AND revision > ?
    ORDER BY revision, operation, chunk_id
    LIMIT ?
  `,
} as const;

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
    2.5,
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
