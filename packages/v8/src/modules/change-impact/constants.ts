export const CHANGE_IMPACT_SCHEMA_VERSION = 1 as const;

export const CHANGE_IMPACT_STATUSES = [
  "ok",
  "partial",
  "empty",
  "unavailable",
] as const;

export const CHANGE_IMPACT_DIRECTIONS = ["dependents", "dependencies"] as const;

export const CHANGE_IMPACT_EDGE_TYPES = [
  "calls",
  "imports",
  "references",
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
] as const;

export const CHANGE_IMPACT_ERROR_CODES = [
  "invalid_input",
  "misconfigured",
] as const;

export const CHANGE_IMPACT_WARNING_CODES = [
  "graph_partial",
  "seed_file_only",
  "evidence_truncated",
] as const;
