export const DEFAULT_CHANGE_IMPACT_MAXIMUM_HOPS = 3;
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_AFFECTED_NODES = 80;
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_PACKAGES = 20;
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_EVIDENCE_PER_NODE = 5;
/** Cap path/chain enumeration separately from the node report budget. */
export const DEFAULT_CHANGE_IMPACT_MAXIMUM_PATHS = 48;

/** Prefer exported / externally referenced symbols over exploding every symbol. */
export const DEFAULT_CHANGE_IMPACT_SEED_EXPANSION = "file_exports" as const;

/**
 * Score multipliers applied on top of (weight * edgeFactor) / hop.
 * Fan-in uses walk-direction in-degree of the discovered node.
 */
export const DEFAULT_CHANGE_IMPACT_FAN_IN_WEIGHT = 0.08;
export const DEFAULT_CHANGE_IMPACT_FAN_IN_CAP = 12;
export const DEFAULT_CHANGE_IMPACT_EVIDENCE_WEIGHT = 0.04;
export const DEFAULT_CHANGE_IMPACT_EVIDENCE_CAP = 5;
/** Soft demotion for test-bucket files so prod surfaces rank first at equal hop. */
export const DEFAULT_CHANGE_IMPACT_TEST_SCORE_FACTOR = 0.85;
/**
 * Optional multiplier from published RepoMap importance (PageRank/composite).
 * Applied as `1 + weight * min(cap, importance)`.
 */
export const DEFAULT_CHANGE_IMPACT_PAGE_RANK_WEIGHT = 0.25;
export const DEFAULT_CHANGE_IMPACT_PAGE_RANK_CAP = 1;
/** Cap LSP/code-nav enrichment merge into affected files. */
export const DEFAULT_CHANGE_IMPACT_LSP_ENRICH_MAX_FILES = 16;

/**
 * Model-facing caps: keep sequencing useful under tool-result budgets.
 * Full walk may still visit up to maximumAffectedNodes; the tool output
 * prefers affectedFiles and a top-N affected node slice.
 */
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_AFFECTED_NODES = 8;
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_EVIDENCE_PER_NODE = 1;
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_AFFECTED_FILES = 24;
export const DEFAULT_CHANGE_IMPACT_MODEL_FACING_CHAINS = 12;

/**
 * Graph confidence = resolved structural edges / (resolved + unresolved).
 * Below low → warning; below unsafe → reason code + force partial status.
 */
export const DEFAULT_CHANGE_IMPACT_CONFIDENCE_LOW = 0.85;
export const DEFAULT_CHANGE_IMPACT_CONFIDENCE_UNSAFE = 0.7;

/** Blast level thresholds on unique affected files (full walk, not model-facing). */
export const DEFAULT_CHANGE_IMPACT_BLAST_MEDIUM_FILES = 8;
export const DEFAULT_CHANGE_IMPACT_BLAST_HIGH_FILES = 40;
export const DEFAULT_CHANGE_IMPACT_BLAST_MEDIUM_HOP1 = 5;
export const DEFAULT_CHANGE_IMPACT_BLAST_HIGH_HOP1 = 18;

/** Risk score bands → SAFE / REVIEW / TEST / CRITICAL. */
export const DEFAULT_CHANGE_IMPACT_RISK_REVIEW = 21;
export const DEFAULT_CHANGE_IMPACT_RISK_TEST = 51;
export const DEFAULT_CHANGE_IMPACT_RISK_CRITICAL = 76;

/**
 * Path tokens that raise risk when present on the seed (case-insensitive path
 * segments). Kept generic — hosts may override via policy later.
 */
export const DEFAULT_CHANGE_IMPACT_SENSITIVE_PATH_TOKENS = [
  "auth",
  "oauth",
  "password",
  "credential",
  "secret",
  "session",
  "payment",
  "billing",
  "security",
  "crypto",
  "token",
] as const;

/**
 * Historical coupling is host-published. Structural score stays primary;
 * co-change may multiply by at most `(1 + weight * cappedNormalizedCount)`.
 */
export const DEFAULT_CHANGE_IMPACT_CO_CHANGE_WEIGHT = 0.2;
export const DEFAULT_CHANGE_IMPACT_CO_CHANGE_COUNT_CAP = 8;
/** Minimum co-change count to surface a non-structural (hidden) coupling. */
export const DEFAULT_CHANGE_IMPACT_HIDDEN_COUPLING_MIN = 3;
/** Cap how many hidden-coupling files may be merged into the report. */
export const DEFAULT_CHANGE_IMPACT_HIDDEN_COUPLING_MAX_FILES = 12;
/** Base score for evidence-gated hidden coupling additions. */
export const DEFAULT_CHANGE_IMPACT_HIDDEN_COUPLING_BASE_SCORE = 0.42;
/** Maximum seed-neighborhood cycles reported. */
export const DEFAULT_CHANGE_IMPACT_MAX_CYCLES = 8;
export const DEFAULT_CHANGE_IMPACT_MAX_CYCLE_LENGTH = 8;

/** Multi-seed / plan-check budgets. */
export const DEFAULT_CHANGE_IMPACT_MAX_SEEDS = 16;
export const DEFAULT_CHANGE_IMPACT_MAX_PROPOSED_PATHS = 40;
