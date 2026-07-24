import type {
  RepoMapScoreReasonType,
  RepoMapSymbolKind,
  RepoMapStatus,
} from "./types";

export const REPO_MAP_SCHEMA_VERSION = 1 as const;

export const REPO_MAP_STATUSES = [
  "complete",
  "partial",
  "cancelled",
] as const satisfies readonly RepoMapStatus[];

export const REPO_MAP_SCORE_REASON_TYPES = [
  "current_file",
  "open_file",
  "git_diff",
  "diagnostic",
  "recent_edit",
  "query_path",
  "query_symbol",
  "reference_count",
  "import_count",
  "page_rank",
  "entry_point",
] as const satisfies readonly RepoMapScoreReasonType[];

export const REPO_MAP_SYMBOL_KINDS = [
  "class",
  "interface",
  "struct",
  "function",
  "method",
  "type",
  "enum",
  "const",
  "variable",
  "module",
  "namespace",
  "property",
  "symbol",
] as const satisfies readonly RepoMapSymbolKind[];

export const REPO_MAP_DEFAULTS = {
  MAXIMUM_FILES: 20_000,

  SYMBOL_BATCH_SIZE: 500,
  GRAPH_BATCH_SIZE: 1_000,

  MAXIMUM_SYMBOLS_PER_FILE: 20,

  PAGE_RANK_ITERATIONS: 30,
  PAGE_RANK_DAMPING: 0.85,

  MAXIMUM_ENTRIES: 100,
  MAXIMUM_SYMBOLS_PER_ENTRY: 20,
  MAXIMUM_ESTIMATED_TOKENS: 2_000,
  MINIMUM_ENTRIES: 3,

  APPROXIMATE_CHARACTERS_PER_TOKEN: 4,
} as const;

export const REPO_MAP_SCORE_WEIGHTS = {
  CURRENT_FILE: 8,
  OPEN_FILE: 5,
  GIT_DIFF_FILE: 6,
  DIAGNOSTIC_FILE: 4,
  RECENT_EDIT_FILE: 2,

  QUERY_PATH_MATCH: 8,
  QUERY_SYMBOL_EXACT_MATCH: 10,
  QUERY_SYMBOL_PARTIAL_MATCH: 5,

  REFERENCE_COUNT_MULTIPLIER: 0.3,
  MAXIMUM_REFERENCE_COUNT: 15,

  IMPORT_COUNT_MULTIPLIER: 0.15,
  MAXIMUM_IMPORT_COUNT: 10,

  PAGE_RANK_MULTIPLIER: 25,

  ENTRY_POINT: 3,

  PERSONALIZATION_BASE: 0.1,
  PERSONALIZATION_CURRENT_FILE: 5,
  PERSONALIZATION_OPEN_FILE: 3,
  PERSONALIZATION_GIT_DIFF_FILE: 4,
  PERSONALIZATION_DIAGNOSTIC_FILE: 2,
  PERSONALIZATION_RECENT_EDIT_FILE: 1,

  IMPORT_EDGE: 2,
  REFERENCE_EDGE: 0.5,
} as const;

export const REPO_MAP_SYMBOL_KIND_PRIORITY: Readonly<Record<string, number>> = {
  class: 10,
  interface: 9,
  struct: 9,
  function: 8,
  type: 7,
  enum: 7,
  method: 6,
  module: 6,
  namespace: 6,
  const: 5,
  property: 3,
  variable: 2,
  symbol: 1,
};

export const REPO_MAP_PATTERNS = {
  ENTRY_POINT:
    /^(?:index|main|app|server|extension)\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|kts|scala|cs|cpp|c|swift)$/i,

  CONTENT_HASH: /^[a-f0-9]{32,128}$/i,

  SNAPSHOT_ID: /^[a-f0-9]{64}$/,
} as const;

export const REPO_MAP_RENDERING = {
  EMPTY_MAP_TEXT: "(no repository map entries)",

  HEADER_PREFIX: "# Repository map",

  EXPORTED_MARKER: " (exported)",

  SIGNATURE_SEPARATOR: " — ",

  SCORE_DECIMAL_PLACES: 3,
} as const;

export const REPO_MAP_CONSTANTS = {
  SCHEMA_VERSION: REPO_MAP_SCHEMA_VERSION,

  STATUSES: REPO_MAP_STATUSES,

  SCORE_REASON_TYPES: REPO_MAP_SCORE_REASON_TYPES,

  SYMBOL_KINDS: REPO_MAP_SYMBOL_KINDS,

  DEFAULTS: REPO_MAP_DEFAULTS,

  SCORE_WEIGHTS: REPO_MAP_SCORE_WEIGHTS,

  SYMBOL_KIND_PRIORITY: REPO_MAP_SYMBOL_KIND_PRIORITY,

  PATTERNS: REPO_MAP_PATTERNS,

  RENDERING: REPO_MAP_RENDERING,
} as const;
