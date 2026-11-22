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
      tokenize = "unicode61 remove_diacritics 2 tokenchars '_$'"
    );
  `,

  RECREATE_IDENTIFIER_FTS: `
    DROP TRIGGER IF EXISTS text_index_chunks_after_insert;
    DROP TRIGGER IF EXISTS text_index_chunks_before_delete;
    DROP TRIGGER IF EXISTS text_index_chunks_after_update;
    DROP TABLE IF EXISTS text_index_fts;

    CREATE VIRTUAL TABLE text_index_fts USING fts5(
      chunk_id UNINDEXED,
      workspace UNINDEXED,
      root_id UNINDEXED,
      relative_path,
      kind UNINDEXED,
      title,
      content,
      tokenize = "unicode61 remove_diacritics 2 tokenchars '_$'"
    );

    UPDATE text_index_metadata
    SET
      schema_version = 2,
      revision = revision + 1,
      updated_at = unixepoch() * 1000
    WHERE schema_version < 2;
  `,

  CREATE_TRIGRAM_FTS: `
    CREATE VIRTUAL TABLE IF NOT EXISTS text_index_fts_trigram USING fts5(
      chunk_id UNINDEXED,
      workspace UNINDEXED,
      root_id UNINDEXED,
      relative_path,
      kind UNINDEXED,
      title,
      content,
      tokenize = 'trigram'
    );
  `,

  DROP_TRIGRAM_FTS: `
    DROP TABLE IF EXISTS text_index_fts_trigram;
  `,

  INSERT_CHUNK_FTS_TRIGRAM_DIRECT: `
    INSERT INTO text_index_fts_trigram (
      rowid,
      chunk_id,
      workspace,
      root_id,
      relative_path,
      kind,
      title,
      content
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `,

  LIST_CHUNKS_FOR_FTS: `
    SELECT
      rowid AS rowid,
      id AS id,
      workspace AS workspace,
      root_id AS rootId,
      relative_path AS relativePath,
      kind AS kind,
      COALESCE(title, '') AS title,
      content AS content
    FROM text_index_chunks
  `,

  INSERT_CHUNK_FTS_DIRECT: `
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
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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

  DELETE_DOCUMENT_FTS: `
    DELETE FROM text_index_fts
    WHERE rowid IN (
      SELECT rowid
      FROM text_index_chunks
      WHERE workspace = ?
        AND root_id = ?
        AND relative_path = ?
    )
  `,

  DELETE_DOCUMENT_FTS_TRIGRAM: `
    DELETE FROM text_index_fts_trigram
    WHERE rowid IN (
      SELECT rowid
      FROM text_index_chunks
      WHERE workspace = ?
        AND root_id = ?
        AND relative_path = ?
    )
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

  INSERT_CHUNK_FTS: `
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
    SELECT
      rowid,
      id,
      workspace,
      root_id,
      relative_path,
      kind,
      ?,
      ?
    FROM text_index_chunks
    WHERE workspace = ?
      AND id = ?
  `,

  INSERT_CHUNK_FTS_TRIGRAM: `
    INSERT INTO text_index_fts_trigram (
      rowid,
      chunk_id,
      workspace,
      root_id,
      relative_path,
      kind,
      title,
      content
    )
    SELECT
      rowid,
      id,
      workspace,
      root_id,
      relative_path,
      kind,
      ?,
      ?
    FROM text_index_chunks
    WHERE workspace = ?
      AND id = ?
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
    WITH revision_counts AS (
      SELECT
        revision,
        COUNT(*) AS change_count
      FROM text_index_changes
      WHERE workspace = ?
        AND root_id = ?
        AND revision > ?
      GROUP BY revision
    ),
    revision_windows AS (
      SELECT
        revision,
        COALESCE(
          SUM(change_count) OVER (
            ORDER BY revision
            ROWS BETWEEN UNBOUNDED PRECEDING
              AND 1 PRECEDING
          ),
          0
        ) AS preceding_change_count
      FROM revision_counts
    ),
    selected_revisions AS (
      SELECT revision
      FROM revision_windows
      WHERE preceding_change_count < ?
    )
    SELECT
      changes.revision AS revision,
      changes.operation AS kind,
      changes.chunk_id AS chunkId,
      changes.root_id AS rootId,
      changes.relative_path AS relativePath,
      changes.changed_at AS changedAt
    FROM text_index_changes AS changes
    INNER JOIN selected_revisions
      ON selected_revisions.revision = changes.revision
    WHERE changes.workspace = ?
      AND changes.root_id = ?
    ORDER BY
      changes.revision,
      changes.operation,
      changes.chunk_id
  `,
} as const;
