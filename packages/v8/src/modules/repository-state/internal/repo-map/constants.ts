import type {
  RepoMapBudget,
  RepoMapRankerOptions,
  RepoMapRendererOptions,
  RepoMapScoreReasonType,
} from "./types";

export const REPO_MAP_SCHEMA_VERSION =
  1 as const;

export const REPO_MAP_DEFAULTS = {
  MAXIMUM_FILES: 20_000,
  MAXIMUM_SYMBOLS_PER_FILE: 20,
  PAGE_RANK_ITERATIONS: 30,
  PAGE_RANK_DAMPING: 0.85,
  MAXIMUM_ENTRIES: 100,
  MAXIMUM_SYMBOLS_PER_ENTRY: 20,
  MAXIMUM_ESTIMATED_TOKENS: 8_000,
  MINIMUM_ENTRIES: 3,
  ESTIMATED_CHARACTERS_PER_TOKEN: 4,
  ESTIMATED_SYMBOL_OVERHEAD_CHARACTERS: 8,
  MINIMUM_QUERY_TERM_LENGTH: 2,
  PAGE_RANK_EVIDENCE_DECIMAL_PLACES: 6,
} as const;

export const REPO_MAP_PRESELECTION_WEIGHTS = {
  CURRENT_FILE: 1_000,
  GIT_DIFF_FILE: 800,
  OPEN_FILE: 700,
  DIAGNOSTIC_FILE: 600,
  RECENT_EDIT_FILE: 500,
  QUERY_PATH_TERM: 100,
} as const;

export const REPO_MAP_SCORE_WEIGHTS = {
  CURRENT_FILE: 20,
  OPEN_FILE: 12,
  GIT_DIFF_FILE: 10,
  DIAGNOSTIC_FILE: 8,
  RECENT_EDIT_FILE: 4,

  QUERY_PATH_MATCH: 8,
  QUERY_EXACT_PATH_MATCH: 30,
  QUERY_SYMBOL_EXACT_MATCH: 10,
  QUERY_SYMBOL_PARTIAL_MATCH: 5,

  MAXIMUM_INBOUND_IMPORT_COUNT: 10,
  INBOUND_IMPORT_MULTIPLIER: 0.15,

  MAXIMUM_OUTBOUND_IMPORT_COUNT: 10,
  OUTBOUND_IMPORT_MULTIPLIER: 0.03,

  MAXIMUM_INBOUND_REFERENCE_COUNT: 15,
  INBOUND_REFERENCE_MULTIPLIER: 0.3,

  MAXIMUM_OUTBOUND_REFERENCE_COUNT: 15,
  OUTBOUND_REFERENCE_MULTIPLIER: 0.05,

  PAGE_RANK_MULTIPLIER: 25,
  ENTRY_POINT: 3,

  IMPORT_EDGE: 2,
  CALL_EDGE: 1.25,
  REFERENCE_EDGE: 0.5,

  PERSONALIZATION_BASE: 0.1,
  PERSONALIZATION_CURRENT_FILE: 12,
  PERSONALIZATION_OPEN_FILE: 8,
  PERSONALIZATION_GIT_DIFF_FILE: 10,
  PERSONALIZATION_DIAGNOSTIC_FILE: 5,
  PERSONALIZATION_RECENT_EDIT_FILE: 1,
} as const;

export const REPO_MAP_SYMBOL_KIND_PRIORITY: Readonly<
  Record<string, number>
> = {
  class: 50,
  interface: 40,
  struct: 40,
  function: 30,
  method: 20,
  type: 20,
  enum: 20,
  const: 10,
  variable: 5,
  module: 5,
  namespace: 5,
  property: 3,
  symbol: 0,
};

export const REPO_MAP_REASON_ORDER: Readonly<
  Record<RepoMapScoreReasonType, number>
> = {
  current_file: 10,
  git_diff: 20,
  open_file: 30,
  diagnostic: 40,
  recent_edit: 50,
  query_path: 60,
  query_symbol: 70,
  inbound_import: 80,
  outbound_import: 90,
  inbound_reference: 100,
  outbound_reference: 110,
  page_rank: 120,
  entry_point: 130,
};

export const REPO_MAP_PATTERNS = {
  ENTRY_POINT:
    /^(?:index|main|app|server|extension)\.(?:tsx?|jsx?|mjs|cjs|py|go|rs|java|kt|cs)$/i,

  QUERY_TERM:
    /[a-zA-Z0-9_$.-]+/g,
} as const;

export const REPO_MAP_RENDERING = {
  FILE_PREFIX: "## ",
  SYMBOL_PREFIX: "- ",
  STATISTICS_HEADING: "## Repo Map Statistics",
  SCORE_DECIMAL_PLACES: 3,
  EMPTY_SYMBOL_LABEL: "(no indexed symbols)",
  LINE_SEPARATOR: "\n",
  SECTION_SEPARATOR: "\n\n",
} as const;

export const resolveRepoMapRankerOptions = (
  options: RepoMapRankerOptions = {},
): Required<RepoMapRankerOptions> => ({
  maximumFiles:
    options.maximumFiles ??
    REPO_MAP_DEFAULTS.MAXIMUM_FILES,

  maximumSymbolsPerFile:
    options.maximumSymbolsPerFile ??
    REPO_MAP_DEFAULTS
      .MAXIMUM_SYMBOLS_PER_FILE,

  pageRankIterations:
    options.pageRankIterations ??
    REPO_MAP_DEFAULTS
      .PAGE_RANK_ITERATIONS,

  pageRankDamping:
    options.pageRankDamping ??
    REPO_MAP_DEFAULTS.PAGE_RANK_DAMPING,
});

export const resolveRepoMapBudget = (
  budget: RepoMapBudget = {},
): Required<RepoMapBudget> => ({
  maximumEntries:
    budget.maximumEntries ??
    REPO_MAP_DEFAULTS.MAXIMUM_ENTRIES,

  maximumSymbolsPerEntry:
    budget.maximumSymbolsPerEntry ??
    REPO_MAP_DEFAULTS
      .MAXIMUM_SYMBOLS_PER_ENTRY,

  maximumEstimatedTokens:
    budget.maximumEstimatedTokens ??
    REPO_MAP_DEFAULTS
      .MAXIMUM_ESTIMATED_TOKENS,

  minimumEntries:
    budget.minimumEntries ??
    REPO_MAP_DEFAULTS.MINIMUM_ENTRIES,
});

export const resolveRepoMapRendererOptions = (
  options: RepoMapRendererOptions = {},
): Required<RepoMapRendererOptions> => ({
  includeScores:
    options.includeScores ?? false,

  includeEmptyFiles:
    options.includeEmptyFiles ?? true,

  includeStatistics:
    options.includeStatistics ?? true,
});
