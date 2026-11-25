export const CODE_NAVIGATION_SCHEMA_VERSION = 1 as const;

export const CODE_NAVIGATION_OPERATIONS = [
  "definition",
  "type_definition",
  "references",
  "hover",
  "document_symbols",
  "workspace_symbols",
  "implementation",
  "call_hierarchy",
] as const;

/** Architecture capability formula: available | degraded | unavailable. */
export const CODE_NAVIGATION_CAPABILITY_STATUSES = [
  "available",
  "degraded",
  "unavailable",
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
  "type_definition_resolved",
  "references_resolved",
  "hover_resolved",
  "document_symbols_resolved",
  "workspace_symbols_resolved",
  "implementation_resolved",
  "call_hierarchy_resolved",
  "no_locations",
  "language_server_unavailable",
  "repo_graph_fallback",
  "port_unavailable",
  "locations_truncated",
  "hover_truncated",
] as const;

export type CodeNavigationReasonCodeConst =
  (typeof CODE_NAVIGATION_REASON_CODES)[number];

/** Named reason-code accessors — never build codes with string templates. */
export const CODE_NAVIGATION_REASON = {
  definitionResolved: "definition_resolved",
  typeDefinitionResolved: "type_definition_resolved",
  referencesResolved: "references_resolved",
  hoverResolved: "hover_resolved",
  documentSymbolsResolved: "document_symbols_resolved",
  workspaceSymbolsResolved: "workspace_symbols_resolved",
  implementationResolved: "implementation_resolved",
  callHierarchyResolved: "call_hierarchy_resolved",
  noLocations: "no_locations",
  languageServerUnavailable: "language_server_unavailable",
  repoGraphFallback: "repo_graph_fallback",
  portUnavailable: "port_unavailable",
  locationsTruncated: "locations_truncated",
  hoverTruncated: "hover_truncated",
} as const satisfies Record<string, CodeNavigationReasonCodeConst>;

export const CODE_NAVIGATION_ERROR_CODES = [
  "invalid_input",
  "misconfigured",
] as const;

export const CODE_NAVIGATION_WARNING_CODES = [
  "language_server_failed",
  "repo_graph_unavailable",
] as const;

export const CODE_NAVIGATION_MESSAGES = {
  navigateInputInvalid: "Code navigation input failed schema validation.",
  aborted: "Code navigation aborted",
  portUnavailable: "No code-navigation port is configured.",
  hoverRequiresCaret: "Hover requires a caret query.",
  documentSymbolsRequirePath: "Document symbols require a relative path.",
  workspaceSymbolsRequireQuery: "Workspace symbols require a query.",
  operationRequiresCaret: "This operation requires a caret query.",
} as const;

/** Ordered navigate-path stage names (pipeline + logger). */
export const CODE_NAVIGATION_STAGES = {
  resolvePort: "1-resolve-port",
  prepareDocument: "2-prepare-document",
  executeOperation: "3-execute-operation",
} as const;

export type CodeNavigationStageName =
  (typeof CODE_NAVIGATION_STAGES)[keyof typeof CODE_NAVIGATION_STAGES];
