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
