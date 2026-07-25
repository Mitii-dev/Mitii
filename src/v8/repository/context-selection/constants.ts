import type {
  ContextCandidateOrigin,
  ContextRepresentation,
  ContextSelectionBreadth,
  ContextSelectionMode,
  ContextSelectionScoreSignalType,
} from "./types";

export const CONTEXT_SELECTION_SCHEMA_VERSION =
  1 as const;

export const CONTEXT_SELECTION_IDS = {
  SELECTOR:
    "context-selector",
  REQUEST_NORMALIZER:
    "context-selection-request-normalizer",
  CANDIDATE_PREPARER:
    "context-candidate-preparer",
  SCORER:
    "context-selection-scorer",
  DIVERSITY_RANKER:
    "context-diversity-ranker",
  REPRESENTATION_POLICY:
    "context-representation-policy",
  BUDGET_ALLOCATOR:
    "context-budget-allocator",
  REFERENCE_KEY_BUILDER:
    "context-reference-key-builder",
} as const;

export const CONTEXT_SELECTION_DEFAULTS = {
  MODE:
    "agent" as ContextSelectionMode,
  BREADTH:
    "balanced" as ContextSelectionBreadth,

  MAXIMUM_TOKENS:
    12_000,
  MAXIMUM_ITEMS:
    24,
  MAXIMUM_FILES:
    16,
  MAXIMUM_ITEMS_PER_FILE:
    3,
  MINIMUM_ITEMS:
    1,
  MINIMUM_SCORE:
    0.05,

  REQUIRED_OVERFLOW_MODE:
    "partial",

  UNKNOWN_RETRIEVAL_SCORE:
    0.25,
  REQUIRED_SCORE:
    1,

  MULTI_SOURCE_BASE_COUNT:
    1,
  MAXIMUM_MULTI_SOURCE_BONUS_COUNT:
    4,

  QUERY_STEM_MINIMUM_CHARACTERS:
    3,
  MAXIMUM_QUERY_CHARACTERS:
    8_000,
  MAXIMUM_REFERENCES_PER_GROUP:
    250,

  MINIMUM_REPRESENTATION_TOKENS:
    64,
} as const;

export const CONTEXT_SELECTION_LIMITS = {
  MAXIMUM_TOKENS:
    256_000,
  MAXIMUM_ITEMS:
    1_000,
  MAXIMUM_FILES:
    1_000,
  MAXIMUM_ITEMS_PER_FILE:
    100,
  MAXIMUM_MINIMUM_ITEMS:
    1_000,
  MAXIMUM_QUERY_CHARACTERS:
    32_000,
  MAXIMUM_REFERENCES_PER_GROUP:
    1_000,
} as const;

export const CONTEXT_SELECTION_SIGNAL_BOOSTS:
  Readonly<
    Record<
      Exclude<
        ContextSelectionScoreSignalType,
        | "retrieval_score"
        | "diversity_penalty"
      >,
      number
    >
  > = {
  multi_source_agreement:
    0.08,
  query_path_match:
    0.2,
  explicit_file:
    0.48,
  pinned_file:
    0.34,
  current_file:
    0.3,
  current_selection:
    0.45,
  open_file:
    0.1,
  git_diff:
    0.22,
  diagnostic:
    0.24,
  recent_edit:
    0.12,
  required_priority:
    1,
};

export const CONTEXT_SELECTION_MODE_MULTIPLIERS:
  Readonly<
    Record<
      ContextSelectionMode,
      Readonly<
        Partial<
          Record<
            ContextCandidateOrigin,
            number
          >
        >
      >
    >
  > = {
  ask: {
    current_file:
      1.1,
    current_selection:
      1.15,
    open_file:
      1.1,
    git_diff:
      0.75,
    diagnostic:
      1,
  },
  plan: {
    current_file:
      0.85,
    current_selection:
      1,
    open_file:
      0.9,
    git_diff:
      1,
    diagnostic:
      0.9,
  },
  agent: {
    current_file:
      1.15,
    current_selection:
      1.2,
    open_file:
      1,
    git_diff:
      1.2,
    diagnostic:
      1.2,
    recent_edit:
      1.15,
  },
};

export const CONTEXT_SELECTION_DIVERSITY_WEIGHTS:
  Readonly<
    Record<
      ContextSelectionMode,
      Readonly<
        Record<
          ContextSelectionBreadth,
          number
        >
      >
    >
  > = {
  ask: {
    focused:
      0.12,
    balanced:
      0.22,
    broad:
      0.32,
  },
  plan: {
    focused:
      0.18,
    balanced:
      0.3,
    broad:
      0.42,
  },
  agent: {
    focused:
      0.08,
    balanced:
      0.18,
    broad:
      0.3,
  },
};

export const CONTEXT_SELECTION_PATH_SIMILARITY = {
  IDENTICAL_CANDIDATE:
    1,
  SAME_FILE:
    1,
  SAME_DIRECTORY:
    0.55,
  SHARED_SEGMENT_SCALE:
    0.5,
} as const;

export const CONTEXT_SELECTION_REPRESENTATION_TOKENS:
  Readonly<
    Record<
      ContextRepresentation,
      number
    >
  > = {
  full_file:
    2_000,
  exact_range:
    800,
  targeted_excerpt:
    600,
  file_outline:
    320,
  symbol_signature:
    180,
};

export const CONTEXT_SELECTION_REPRESENTATION_QUALITY:
  Readonly<
    Record<
      ContextRepresentation,
      number
    >
  > = {
  full_file:
    1,
  exact_range:
    1,
  targeted_excerpt:
    0.85,
  file_outline:
    0.65,
  symbol_signature:
    0.72,
};

export const CONTEXT_SELECTION_EXCLUDED_PATH_SEGMENTS =
  new Set([
    ".git",
    ".mitii",
    ".thunder",
    "node_modules",
    "dist",
    "build",
    "out",
    "coverage",
    ".cache",
  ]);

export const CONTEXT_SELECTION_ORIGIN_ORDER:
  readonly ContextCandidateOrigin[] = [
  "explicit_file",
  "current_selection",
  "pinned_file",
  "current_file",
  "diagnostic",
  "git_diff",
  "recent_edit",
  "open_file",
  "retrieval",
];

export const CONTEXT_SELECTION_PRIORITY_ORDER = {
  required:
    0,
  preferred:
    1,
  supplementary:
    2,
} as const;

export const CONTEXT_SELECTION_MESSAGES = {
  EMPTY_QUERY:
    "Context selection requires a non-empty query.",
  QUERY_TRUNCATED:
    "The context-selection query exceeded its configured maximum length and was truncated.",
  DUPLICATE_REFERENCE_REMOVED:
    "Duplicate context references were removed during normalization.",
  UPSTREAM_RETRIEVAL_PARTIAL:
    "Hybrid retrieval returned partial evidence.",
  UPSTREAM_RETRIEVAL_FAILED:
    "Hybrid retrieval failed, so context selection could not use retrieved evidence.",
  EXCLUDED_PATH_REMOVED:
    "Internal or generated repository paths were excluded from context.",
  TOKEN_BUDGET_REACHED:
    "The context token budget prevented additional items from being selected.",
  ITEM_LIMIT_REACHED:
    "The context item limit prevented additional items from being selected.",
  FILE_LIMIT_REACHED:
    "The context file limit prevented additional files from being selected.",
  PER_FILE_LIMIT_REACHED:
    "The per-file context limit prevented additional items from being selected.",
  REQUIRED_REFERENCE_OMITTED:
    "A required context reference could not fit within the configured hard limits.",
  REPRESENTATION_DOWNGRADED:
    "A context item was assigned a smaller representation to fit the token budget.",
  UNKNOWN_TOKEN_ESTIMATE:
    "A default token estimate was used because the retrieval candidate had no estimate.",
  INVALID_BUDGET:
    "Context-selection budget values are invalid.",
} as const;
