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
] as const;

export const CHANGE_IMPACT_REASON_CODES = [
  "impact_resolved",
  "no_dependents",
  "no_dependencies",
  "seed_unresolved",
  "seed_ambiguous",
  "graph_unavailable",
  "graph_stale",
  "hop_limit_reached",
  "node_limit_reached",
  "path_limit_reached",
  "seed_soft_resolved",
  "lsp_enriched",
] as const;

export const CHANGE_IMPACT_ERROR_CODES = [
  "invalid_input",
  "misconfigured",
] as const;

export const CHANGE_IMPACT_WARNING_CODES = [
  "graph_partial",
  "seed_file_only",
  "evidence_truncated",
  "seed_soft_matched",
  "lsp_enriched",
] as const;
