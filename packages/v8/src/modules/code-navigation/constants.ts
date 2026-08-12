export const CODE_NAVIGATION_SCHEMA_VERSION = 1 as const;

export const CODE_NAVIGATION_OPERATIONS = [
  "definition",
  "references",
  "hover",
] as const;

export const CODE_NAVIGATION_STATUSES = [
  "resolved",
  "empty",
  "unavailable",
] as const;

export const CODE_NAVIGATION_PROVIDERS = [
  "language_server",
  "repo_graph",
  "none",
] as const;

export const CODE_NAVIGATION_REASON_CODES = [
  "definition_resolved",
  "references_resolved",
  "hover_resolved",
  "no_locations",
  "language_server_unavailable",
  "repo_graph_fallback",
  "port_unavailable",
] as const;

export const CODE_NAVIGATION_ERROR_CODES = [
  "invalid_input",
  "misconfigured",
] as const;

export const CODE_NAVIGATION_WARNING_CODES = [
  "language_server_failed",
  "repo_graph_unavailable",
] as const;
