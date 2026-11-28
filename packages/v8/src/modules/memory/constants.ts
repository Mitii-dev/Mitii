/**
 * Stable identifiers for Memory.
 */
export const MEMORY_SCHEMA_VERSION = 2 as const;

export const MEMORY_SCOPES = ["user", "workspace", "project"] as const;

export const MEMORY_PRIVACY_LEVELS = ["private", "shareable"] as const;

export const MEMORY_FACT_TYPES = [
  "pattern",
  "preference",
  "architecture",
  "bug",
  "workflow",
  "fact",
] as const;

export const MEMORY_RETRIEVAL_STATUSES = [
  "retrieved",
  "empty",
  "blocked",
] as const;

export const MEMORY_COMMIT_STATUSES = [
  "committed",
  "rejected",
  "blocked",
] as const;

export const MEMORY_OMISSION_REASONS = [
  "budget",
  "irrelevant",
  "stale",
  "privacy",
  "scope_mismatch",
  "duplicate",
  "retention",
  "superseded",
] as const;

export const MEMORY_REASON_CODES = [
  "memory_retrieved",
  "no_relevant_memory",
  "budget_omitted_memory",
  "stale_memory_filtered",
  "privacy_filtered",
  "store_empty",
  "memory_committed",
  "commit_rejected",
  "memory_bm25_only",
  "memory_file_boosted",
  "memory_hybrid",
  "memory_superseded",
  "privacy_redacted",
  "memory_duplicate",
  "memory_reinforced",
  "memory_layered",
  "memory_consolidated",
] as const;

export type MemoryReasonCodeConst = (typeof MEMORY_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const MEMORY_REASON = {
  retrieved: "memory_retrieved",
  noRelevant: "no_relevant_memory",
  budgetOmitted: "budget_omitted_memory",
  staleFiltered: "stale_memory_filtered",
  privacyFiltered: "privacy_filtered",
  storeEmpty: "store_empty",
  committed: "memory_committed",
  commitRejected: "commit_rejected",
  bm25Only: "memory_bm25_only",
  fileBoosted: "memory_file_boosted",
  hybrid: "memory_hybrid",
  superseded: "memory_superseded",
  privacyRedacted: "privacy_redacted",
  duplicate: "memory_duplicate",
  reinforced: "memory_reinforced",
  layered: "memory_layered",
  consolidated: "memory_consolidated",
} as const satisfies Record<string, MemoryReasonCodeConst>;

export const MEMORY_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
  "store_failed",
] as const;

export const MEMORY_MESSAGES = {
  retrieveInputInvalid: "Memory retrieve input failed schema validation.",
  commitInputInvalid: "Memory commit input failed schema validation.",
  consolidateInputInvalid: "Invalid memory consolidation input.",
  storeRequired: "MemoryPipeline requires a store port.",
  storeQueryFailed: "Memory store query failed.",
  storeCommitFailed: "Memory store commit failed.",
  correctionNeedsAtomic: "Memory correction requires an atomic store.",
  consolidateNeedsAtomic: "Consolidation requires an atomic store.",
  embeddingUnavailable:
    "Memory embeddings unavailable; using lexical and file retrieval.",
  commitRejected: (reason: string) => `Commit rejected: ${reason}.`,
  privacyRedacted:
    "Sensitive memory fields were redacted before persistence.",
  accessTouchFailed: (detail: string) =>
    `Memory access touch failed: ${detail}`,
} as const;

/** Ordered flow stage names (pipeline + logger). */
export const MEMORY_STAGES = {
  filterCandidates: "1-filter-candidates",
  scoreRelevance: "2-score-relevance",
  applyBudget: "3-apply-budget",
  prepareCommit: "4-prepare-commit",
  commitAndConsolidate: "5-commit-and-consolidate",
  buildSyntheticDraft: "6-build-synthetic-draft",
} as const;

export type MemoryStageName =
  (typeof MEMORY_STAGES)[keyof typeof MEMORY_STAGES];
