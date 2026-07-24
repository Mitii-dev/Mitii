export const CODE_INDEX_DEFAULTS = {
  SQLITE_BATCH_SIZE: 500,
  MAXIMUM_SYMBOLS_PER_FILE: 200,
} as const;

export const CODE_INDEX_IDS = {
  SQLITE_ADAPTER: "sqlite-code-index",
  FILE_PREFIX: "sqlite-file",
  SYMBOL_PREFIX: "sqlite-symbol",
} as const;

export const CODE_INDEX_LANGUAGE_BY_EXTENSION: Readonly<
  Record<string, string>
> = {
  ts: "typescript",
  tsx: "typescript-react",

  js: "javascript",
  jsx: "javascript-react",

  mjs: "javascript",
  cjs: "javascript",

  py: "python",
  go: "go",
  rs: "rust",

  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",

  cs: "csharp",

  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",

  c: "c",
  h: "c",

  rb: "ruby",
  php: "php",
  swift: "swift",

  vue: "vue",
  svelte: "svelte",

  sql: "sql",
  graphql: "graphql",

  sh: "shell",
  bash: "shell",
};

export const CODE_INDEX_PATTERNS = {
  SNAPSHOT_ID: /^[a-f0-9]{64}$/,

  CONTENT_HASH: /^[a-f0-9]{32,128}$/i,

  SAFE_NUMERIC_ID: /^\d+$/,
} as const;

export const SQLITE_CODE_INDEX_SQL = {
  GET_WATERMARK: `
    SELECT
      MAX(indexed_at) AS watermark
    FROM files
    WHERE workspace = ?
  `,

  GET_FILES_PREFIX: `
    SELECT
      id,
      rel_path AS relativePath,
      indexed_at AS indexedAt
    FROM files
    WHERE workspace = ?
      AND rel_path IN
  `,

  GET_SYMBOLS_PREFIX: `
    SELECT
      s.id,
      s.file_id AS fileId,
      s.name,
      s.kind,
      s.signature,
      s.start_line AS startLine,
      s.end_line AS endLine
    FROM symbols s
    INNER JOIN files source_file
      ON source_file.id = s.file_id
    WHERE source_file.workspace = ?
      AND s.file_id IN
  `,

  GET_IMPORTS_PREFIX: `
    SELECT
      fi.from_file_id AS fromFileId,
      target_file.id AS targetFileId,
      fi.to_rel_path AS targetRelativePath
    FROM file_imports fi
    INNER JOIN files source_file
      ON source_file.id = fi.from_file_id
    LEFT JOIN files target_file
      ON target_file.workspace = source_file.workspace
      AND target_file.rel_path = fi.to_rel_path
    WHERE source_file.workspace = ?
      AND fi.from_file_id IN
  `,

  GET_REFERENCES_PREFIX: `
    SELECT
      sr.file_id AS fromFileId,
      sr.symbol_name AS symbolName,
      target_symbol.id AS targetSymbolId,
      target_symbol.file_id AS targetFileId
    FROM symbol_refs sr
    INNER JOIN files source_file
      ON source_file.id = sr.file_id
    LEFT JOIN symbols target_symbol
      ON target_symbol.name = sr.symbol_name
      AND target_symbol.file_id != sr.file_id
    LEFT JOIN files target_file
      ON target_file.id = target_symbol.file_id
      AND target_file.workspace = source_file.workspace
    WHERE source_file.workspace = ?
      AND sr.file_id IN
  `,
} as const;

export const CODE_INDEX_CONSTANTS = {
  DEFAULTS: CODE_INDEX_DEFAULTS,

  IDS: CODE_INDEX_IDS,

  LANGUAGE_BY_EXTENSION: CODE_INDEX_LANGUAGE_BY_EXTENSION,

  PATTERNS: CODE_INDEX_PATTERNS,

  SQLITE: SQLITE_CODE_INDEX_SQL,
} as const;
