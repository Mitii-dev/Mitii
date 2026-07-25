import type {
  CodeIndexUpdatePlannerInput,
} from "./types";

export const CODE_INDEXING_SCHEMA_VERSION = 1 as const;

export const CODE_INDEXING_IDS = {
  SQLITE_WRITER: "sqlite-code-index-writer",
} as const;

export const CODE_INDEXING_DEFAULTS = {
  ANALYSIS_VERSION: "source-analysis-v1",
  IMPORT_EXTENSIONS: [
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".json",
    ".py",
    ".go",
    ".rs",
    ".java",
    ".kt",
    ".kts",
  ] as readonly string[],
  INDEX_BASENAMES: [
    "index",
    "mod",
    "__init__",
  ] as readonly string[],
} as const;

export const CODE_INDEXING_PATTERNS = {
  CONTENT_HASH: /^[a-f0-9]{16,128}$/i,
  RELATIVE_IMPORT: /^\.{1,2}(?:\/|$)/,
  WINDOWS_ABSOLUTE_PATH: /^[a-zA-Z]:[\\/]/,
} as const;

export const CODE_INDEXING_TABLES = {
  FILES: "files",
  SYMBOLS: "symbols",
  IMPORTS: "file_imports",
  REFERENCES: "symbol_refs",
  METADATA: "code_index_metadata",
} as const;

export const CODE_INDEXING_COLUMNS = {
  FILES: {
    ROOT_ID: "root_id",
    ANALYSIS_VERSION: "analysis_version",
    ANALYSIS_STATUS: "analysis_status",
    ANALYSIS_QUALITY: "analysis_quality",
    PARSER_ID: "parser_id",
    SNAPSHOT_ID: "snapshot_id",
  },
  SYMBOLS: {
    LOCAL_ID: "local_id",
    EXPORTED: "exported",
    START_COLUMN: "start_column",
    END_COLUMN: "end_column",
  },
  IMPORTS: {
    RESOLUTION: "resolution",
    IMPORT_KIND: "import_kind",
    IMPORTED_NAMES_JSON: "imported_names_json",
    COLUMN_INDEX: "column_index",
    CANDIDATE_REL_PATH: "candidate_rel_path",
  },
  REFERENCES: {
    REFERENCE_KIND: "reference_kind",
    COLUMN_INDEX: "column_index",
  },
} as const;

export const CODE_INDEXING_MIGRATION_SQL = {
  CREATE_BASE_SCHEMA: `
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      workspace TEXT NOT NULL,
      path TEXT NOT NULL,
      rel_path TEXT NOT NULL,
      hash TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime INTEGER NOT NULL,
      language TEXT,
      indexed_at INTEGER,
      UNIQUE(workspace, rel_path)
    );

    CREATE TABLE IF NOT EXISTS symbols (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      kind TEXT NOT NULL,
      signature TEXT,
      start_line INTEGER,
      end_line INTEGER,
      parent_symbol_id INTEGER REFERENCES symbols(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS file_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      from_file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      to_rel_path TEXT NOT NULL,
      specifier TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS symbol_refs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_id INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
      symbol_name TEXT NOT NULL,
      line INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS code_index_metadata (
      workspace TEXT NOT NULL,
      root_id TEXT NOT NULL,
      schema_version INTEGER NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      snapshot_id TEXT,
      updated_at INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(workspace, root_id)
    );

    CREATE INDEX IF NOT EXISTS idx_code_index_files_workspace
      ON files(workspace, rel_path);

    CREATE INDEX IF NOT EXISTS idx_code_index_symbols_file
      ON symbols(file_id, start_line);

    CREATE INDEX IF NOT EXISTS idx_code_index_imports_file
      ON file_imports(from_file_id, line);

    CREATE INDEX IF NOT EXISTS idx_code_index_references_file
      ON symbol_refs(file_id, line);
  `,

  FILE_COLUMN_ALTERS: {
    root_id:
      `ALTER TABLE files ADD COLUMN root_id TEXT NOT NULL DEFAULT ''`,
    analysis_version:
      `ALTER TABLE files ADD COLUMN analysis_version TEXT NOT NULL DEFAULT 'legacy'`,
    analysis_status:
      `ALTER TABLE files ADD COLUMN analysis_status TEXT NOT NULL DEFAULT 'complete'`,
    analysis_quality:
      `ALTER TABLE files ADD COLUMN analysis_quality TEXT NOT NULL DEFAULT 'heuristic'`,
    parser_id:
      `ALTER TABLE files ADD COLUMN parser_id TEXT`,
    snapshot_id:
      `ALTER TABLE files ADD COLUMN snapshot_id TEXT`,
  },

  SYMBOL_COLUMN_ALTERS: {
    local_id:
      `ALTER TABLE symbols ADD COLUMN local_id TEXT`,
    exported:
      `ALTER TABLE symbols ADD COLUMN exported INTEGER`,
    start_column:
      `ALTER TABLE symbols ADD COLUMN start_column INTEGER`,
    end_column:
      `ALTER TABLE symbols ADD COLUMN end_column INTEGER`,
  },

  IMPORT_COLUMN_ALTERS: {
    resolution:
      `ALTER TABLE file_imports ADD COLUMN resolution TEXT NOT NULL DEFAULT 'unresolved'`,
    import_kind:
      `ALTER TABLE file_imports ADD COLUMN import_kind TEXT NOT NULL DEFAULT 'unknown'`,
    imported_names_json:
      `ALTER TABLE file_imports ADD COLUMN imported_names_json TEXT NOT NULL DEFAULT '[]'`,
    column_index:
      `ALTER TABLE file_imports ADD COLUMN column_index INTEGER`,
    candidate_rel_path:
      `ALTER TABLE file_imports ADD COLUMN candidate_rel_path TEXT`,
  },

  REFERENCE_COLUMN_ALTERS: {
    reference_kind:
      `ALTER TABLE symbol_refs ADD COLUMN reference_kind TEXT NOT NULL DEFAULT 'unknown'`,
    column_index:
      `ALTER TABLE symbol_refs ADD COLUMN column_index INTEGER`,
  },
} as const;

export const CODE_INDEXING_SQL = {
  GET_FILE_STATE: `
    SELECT
      workspace AS workspace,
      root_id AS rootId,
      rel_path AS relativePath,
      path AS providerPath,
      hash AS hash,
      size AS size,
      mtime AS modifiedAt,
      language AS language,
      analysis_version AS analysisVersion,
      analysis_status AS analysisStatus,
      indexed_at AS indexedAt
    FROM files
    WHERE workspace = ?
      AND root_id = ?
      AND rel_path = ?
    LIMIT 1
  `,

  UPSERT_FILE: `
    INSERT INTO files (
      workspace,
      root_id,
      path,
      rel_path,
      hash,
      size,
      mtime,
      language,
      indexed_at,
      analysis_version,
      analysis_status,
      analysis_quality,
      parser_id,
      snapshot_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace, rel_path) DO UPDATE SET
      root_id = excluded.root_id,
      path = excluded.path,
      hash = excluded.hash,
      size = excluded.size,
      mtime = excluded.mtime,
      language = excluded.language,
      indexed_at = excluded.indexed_at,
      analysis_version = excluded.analysis_version,
      analysis_status = excluded.analysis_status,
      analysis_quality = excluded.analysis_quality,
      parser_id = excluded.parser_id,
      snapshot_id = excluded.snapshot_id
  `,

  GET_FILE_ID: `
    SELECT id
    FROM files
    WHERE workspace = ?
      AND root_id = ?
      AND rel_path = ?
    LIMIT 1
  `,

  UPDATE_FILE_METADATA: `
    UPDATE files
    SET
      path = ?,
      size = ?,
      mtime = ?,
      language = ?,
      snapshot_id = ?
    WHERE workspace = ?
      AND root_id = ?
      AND rel_path = ?
  `,

  DELETE_SYMBOLS:
    `DELETE FROM symbols WHERE file_id = ?`,
  DELETE_IMPORTS:
    `DELETE FROM file_imports WHERE from_file_id = ?`,
  DELETE_REFERENCES:
    `DELETE FROM symbol_refs WHERE file_id = ?`,

  INSERT_SYMBOL: `
    INSERT INTO symbols (
      file_id,
      local_id,
      name,
      kind,
      signature,
      start_line,
      end_line,
      exported,
      start_column,
      end_column,
      parent_symbol_id
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
  `,

  UPDATE_SYMBOL_PARENT: `
    UPDATE symbols
    SET parent_symbol_id = ?
    WHERE id = ?
  `,

  INSERT_IMPORT: `
    INSERT INTO file_imports (
      from_file_id,
      to_rel_path,
      specifier,
      line,
      resolution,
      import_kind,
      imported_names_json,
      column_index,
      candidate_rel_path
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,

  INSERT_REFERENCE: `
    INSERT INTO symbol_refs (
      file_id,
      symbol_name,
      line,
      reference_kind,
      column_index
    )
    VALUES (?, ?, ?, ?, ?)
  `,

  DELETE_FILE: `
    DELETE FROM files
    WHERE workspace = ?
      AND root_id = ?
      AND rel_path = ?
  `,

  GET_ROOT_FILES: `
    SELECT rel_path AS relativePath
    FROM files
    WHERE workspace = ?
      AND root_id = ?
    ORDER BY rel_path
  `,

  ENSURE_METADATA: `
    INSERT INTO code_index_metadata (
      workspace,
      root_id,
      schema_version,
      revision,
      snapshot_id,
      updated_at
    )
    VALUES (?, ?, ?, 0, ?, ?)
    ON CONFLICT(workspace, root_id) DO NOTHING
  `,

  BUMP_REVISION: `
    UPDATE code_index_metadata
    SET
      revision = revision + 1,
      schema_version = ?,
      snapshot_id = ?,
      updated_at = ?
    WHERE workspace = ?
      AND root_id = ?
  `,

  GET_REVISION: `
    SELECT revision
    FROM code_index_metadata
    WHERE workspace = ?
      AND root_id = ?
    LIMIT 1
  `,
} as const;

export function metadataChanged(
  input: CodeIndexUpdatePlannerInput,
): boolean {
  const desired = input.desired;
  const current = input.current;

  if (!desired || !current) {
    return false;
  }

  return (
    desired.providerPath !== current.providerPath ||
    desired.size !== current.size ||
    desired.modifiedAt !== current.modifiedAt ||
    desired.language !== current.language
  );
}
