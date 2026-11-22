export const CHANGE_IMPACT_SCHEMA_VERSION = 1 as const;

export const CHANGE_IMPACT_STATUSES = [
  "ok",
  "partial",
  "empty",
  "unavailable",
] as const;

export const CHANGE_IMPACT_DIRECTIONS = ["dependents", "dependencies"] as const;

/**
 * How a file seed expands into graph nodes before the walk.
 * - `file`: file node only (plus project when includePackages).
 * - `file_exports`: file + exported / externally-referenced symbols (default).
 * - `file_all_symbols`: file + every symbol in the file (legacy wide expand).
 */
export const CHANGE_IMPACT_SEED_EXPANSIONS = [
  "file",
  "file_exports",
  "file_all_symbols",
] as const;

export const CHANGE_IMPACT_FILE_BUCKETS = ["prod", "test"] as const;

export const CHANGE_IMPACT_EDGE_TYPES = [
  "calls",
  "imports",
  "references",
  "extends",
  "implements",
  "depends_on",
  "development_depends_on",
  "workspace_member",
] as const;

/** Stable why-code for an affected file (auditable selection reason). */
export const CHANGE_IMPACT_FILE_REASONS = [
  "direct",
  "transitive",
  "package",
  "workspace_member",
  "navigation_enrichment",
  "identity_overlay",
  "historical_coupling",
  "hidden_coupling",
] as const;

export const CHANGE_IMPACT_PATH_IDENTITY_KINDS = [
  "renamed",
  "deleted",
] as const;

export const CHANGE_IMPACT_BLAST_LEVELS = ["low", "medium", "high"] as const;

export const CHANGE_IMPACT_RISK_TIERS = [
  "safe",
  "review",
  "test",
  "critical",
] as const;

export const CHANGE_IMPACT_REASON_CODES = [
  "impact_resolved",
  "no_dependents",
  "no_dependencies",
  "seed_unresolved",
  "seed_ambiguous",
  "graph_unavailable",
  "graph_stale",
  "graph_confidence_unsafe",
  "hop_limit_reached",
  "node_limit_reached",
  "path_limit_reached",
  "seed_soft_resolved",
  "seed_rollup_expanded",
  "path_identity_remapped",
  "historical_coupling_applied",
  "hidden_coupling_detected",
  "seed_cycle_detected",
  "multi_seed_merged",
  "spillover_detected",
  "spillover_clean",
  "plan_check_complete",
  "lsp_enriched",
] as const;

export const CHANGE_IMPACT_ERROR_CODES = [
  "invalid_input",
  "misconfigured",
] as const;

export const CHANGE_IMPACT_WARNING_CODES = [
  "graph_partial",
  "graph_confidence_low",
  "graph_confidence_unsafe",
  "seed_file_only",
  "evidence_truncated",
  "seed_soft_matched",
  "seed_rollup_expanded",
  "path_identity_remapped",
  "historical_coupling_applied",
  "hidden_coupling_detected",
  "seed_cycle_detected",
  "multi_seed_merged",
  "spillover_detected",
  "plan_check_complete",
  "lsp_enriched",
] as const;
