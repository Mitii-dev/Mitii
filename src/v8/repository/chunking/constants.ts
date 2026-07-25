import type {
  ChunkInputOverflowPolicy,
  ChunkKind,
} from "./types";

export const CHUNKING_SCHEMA_VERSION =
  1 as const;

export const CHUNKING_IDS = {
  SERVICE: "chunking-service",
  NORMALIZER: "chunk-normalizer",
  NODE_SHA256_HASHER: "node-sha256",
  CHARACTER_TOKEN_ESTIMATOR: "character-token-estimator",

  CODE_STRATEGY: "code",
  MARKDOWN_STRATEGY: "markdown",
  TEXT_STRATEGY: "text",

  CHUNK_PREFIX: "chunk",
} as const;

export const CHUNKING_DEFAULTS = {
  MAXIMUM_INPUT_CHARACTERS:
    2_000_000,

  INPUT_OVERFLOW_POLICY:
    "truncate" as ChunkInputOverflowPolicy,

  TARGET_CHUNK_CHARACTERS:
    1_600,

  MAXIMUM_CHUNK_CHARACTERS:
    2_200,

  MINIMUM_CHUNK_CHARACTERS:
    200,

  OVERLAP_CHARACTERS:
    160,

  BOUNDARY_SEARCH_CHARACTERS:
    480,

  MAXIMUM_CHUNKS:
    2_000,

  MAXIMUM_TITLE_CHARACTERS:
    160,

  CHARACTERS_PER_ESTIMATED_TOKEN:
    4,
} as const;

export const CHUNKING_STRATEGY_PRIORITIES = {
  CODE: 300,
  MARKDOWN: 250,
  TEXT: 100,
} as const;

export const CHUNKING_PATTERNS = {
  CONTENT_HASH:
    /^[a-f0-9]{16,128}$/,

  MARKDOWN_HEADING:
    /^(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/,

  CODE_DECLARATION:
    /^\s*(?:(?:export|default|public|private|protected|internal|static|abstract|final|sealed|async|declare|unsafe|open|override)\s+)*(?:class|interface|struct|trait|enum|function|def|func|fn|type|namespace|module|record|object|contract|impl)\b/i,

  CODE_NAMED_ASSIGNMENT:
    /^\s*(?:(?:export|public|private|protected|static|readonly|const|let|var)\s+)+(?:async\s+)?[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/i,

  CANONICAL_RELATIVE_PATH_INVALID_SEGMENT:
    /(?:^|\/)(?:\.{1,2}|)(?:\/|$)/,
} as const;

export const CHUNKING_BOUNDARIES = {
  PARAGRAPH: "\n\n",
  LINE: "\n",
  WHITESPACE: " ",
} as const;

export const CHUNKING_CODE_LANGUAGES =
  new Set<string>([
    "typescript",
    "tsx",
    "javascript",
    "jsx",
    "python",
    "java",
    "kotlin",
    "go",
    "rust",
    "c",
    "cpp",
    "csharp",
    "ruby",
    "php",
    "swift",
    "scala",
    "lua",
    "elixir",
    "solidity",
    "zig",
    "dart",
    "bash",
    "sql",
    "hcl",
    "proto",
    "vue",
    "svelte",
    "css",
    "scss",
  ]);

export const CHUNKING_CODE_EXTENSIONS =
  new Set<string>([
    ".ts",
    ".mts",
    ".cts",
    ".tsx",
    ".js",
    ".mjs",
    ".cjs",
    ".jsx",
    ".py",
    ".pyi",
    ".pyw",
    ".java",
    ".kt",
    ".kts",
    ".go",
    ".rs",
    ".c",
    ".h",
    ".cpp",
    ".cc",
    ".cxx",
    ".hpp",
    ".hxx",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".scala",
    ".lua",
    ".ex",
    ".exs",
    ".sol",
    ".zig",
    ".dart",
    ".sh",
    ".bash",
    ".zsh",
    ".sql",
    ".tf",
    ".tfvars",
    ".proto",
    ".vue",
    ".svelte",
    ".css",
    ".scss",
  ]);

export const CHUNKING_MARKDOWN_LANGUAGES =
  new Set<string>([
    "markdown",
    "mdx",
  ]);

export const CHUNKING_MARKDOWN_EXTENSIONS =
  new Set<string>([
    ".md",
    ".mdx",
  ]);

export const CHUNKING_KIND_ORDER: Readonly<
  Record<ChunkKind, number>
> = {
  code_symbol: 10,
  code_region: 20,
  markdown_section: 30,
  text: 40,
};

export const CHUNKING_MESSAGES = {
  INPUT_TRUNCATED:
    "The source exceeded the configured input limit; only a prefix was chunked.",

  INPUT_REJECTED:
    "The source exceeded the configured input limit and the overflow policy rejected it.",

  SOURCE_ANALYSIS_MISMATCH:
    "The supplied source analysis belongs to a different source and was ignored.",

  SOURCE_ANALYSIS_UNUSABLE:
    "The supplied source analysis does not contain usable top-level symbol ranges.",

  STRATEGY_RETURNED_EMPTY:
    "The strategy returned no usable spans for non-empty source content.",

  INVALID_SPAN:
    "A strategy returned an invalid chunk span; the span was ignored.",

  DUPLICATE_SPAN:
    "A duplicate chunk span was removed.",

  CHUNKS_TRUNCATED:
    "The configured maximum chunk count was reached.",

  CANCELLED:
    "Chunking was cancelled.",
} as const;

export const CHUNKING_ERRORS = {
  REGISTRY_FROZEN:
    "Chunking strategy registry is frozen.",

  DUPLICATE_STRATEGY:
    "Chunking strategy is already registered.",

  SOURCE_ID_REQUIRED:
    "sourceId must be a non-empty string.",

  ROOT_ID_REQUIRED:
    "rootId must be a non-empty string.",

  RELATIVE_PATH_REQUIRED:
    "relativePath must be a canonical, non-empty workspace-relative path.",

  HASH_INVALID:
    "contentHash must be a lowercase hexadecimal value between 16 and 128 characters.",

  POSITIVE_INTEGER_REQUIRED:
    "Expected a positive safe integer.",

  NON_NEGATIVE_INTEGER_REQUIRED:
    "Expected a non-negative safe integer.",

  TARGET_EXCEEDS_MAXIMUM:
    "targetChunkCharacters cannot exceed maximumChunkCharacters.",

  MINIMUM_EXCEEDS_TARGET:
    "minimumChunkCharacters cannot exceed targetChunkCharacters.",

  OVERLAP_TOO_LARGE:
    "overlapCharacters must be smaller than targetChunkCharacters.",
} as const;

