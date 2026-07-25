export const CODE_INDEX_IDS = {
  SQLITE_ADAPTER: "sqlite-code-index",
  FILE_PREFIX: "file",
  SYMBOL_PREFIX: "symbol",
} as const;

export const CODE_INDEX_DEFAULTS = {
  SQLITE_BATCH_SIZE: 400,
  MAXIMUM_SYMBOLS_PER_FILE: 200,
} as const;

export const CODE_INDEX_PATTERNS = {
  CONTENT_HASH: /^[a-f0-9]{16,128}$/i,
} as const;

export const CODE_INDEX_LANGUAGE_BY_EXTENSION: Readonly<
  Record<string, string>
> = {
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  go: "go",
  rs: "rust",
  cs: "csharp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  c: "c",
  h: "c",
  hpp: "cpp",
  rb: "ruby",
  php: "php",
  swift: "swift",
  scala: "scala",
  sql: "sql",
  graphql: "graphql",
  json: "json",
  jsonl: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  md: "markdown",
  mdx: "markdown",
  css: "css",
  scss: "scss",
  sass: "sass",
  less: "less",
  html: "html",
  vue: "vue",
  svelte: "svelte",
  sh: "shell",
  bash: "shell",
  tf: "terraform",
  proto: "protobuf",
};

export const SQLITE_CODE_INDEX_SQL = {
  GET_WATERMARK: `
    SELECT
      COUNT(*) AS fileCount,
      MAX(indexed_at) AS indexedAtMaximum,
      COALESCE(SUM(indexed_at), 0) AS indexedAtSum,
      COALESCE(SUM(id), 0) AS idSum
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
      s.id AS id,
      s.file_id AS fileId,
      s.name AS name,
      s.kind AS kind,
      s.signature AS signature,
      s.start_line AS startLine,
      s.end_line AS endLine,
      parent_symbol.name AS parentName,
      parent_symbol.kind AS parentKind,
      parent_symbol.start_line AS parentStartLine
    FROM symbols s
    JOIN files source_file
      ON source_file.id = s.file_id
    LEFT JOIN symbols parent_symbol
      ON parent_symbol.id = s.parent_symbol_id
    WHERE source_file.workspace = ?
      AND s.file_id IN
  `,

  GET_IMPORTS_PREFIX: `
    SELECT
      fi.from_file_id AS fromFileId,
      target_file.id AS targetFileId,
      fi.to_rel_path AS targetRelativePath,
      fi.specifier AS specifier,
      fi.line AS line
    FROM file_imports fi
    JOIN files source_file
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
      sr.line AS line,
      target_symbol.file_id AS targetFileId,
      target_file.rel_path AS targetRelativePath,
      target_symbol.name AS targetSymbolName,
      target_symbol.kind AS targetSymbolKind,
      target_symbol.start_line AS targetSymbolStartLine
    FROM symbol_refs sr
    JOIN files source_file
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

