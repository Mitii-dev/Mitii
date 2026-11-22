/**
 * Built-in tool ID lists. Decision Policy is the single owner: grants and the
 * Tool Runtime catalog both consume these so they cannot drift.
 */

/** Symbol-level code intelligence tools (language service or repo-graph). */
export const CODE_INTELLIGENCE_TOOL_IDS = [
  "goto_definition",
  "find_type_definition",
  "find_references",
  "hover_symbol",
  "document_symbol",
  "workspace_symbol",
  "find_implementation",
  "call_hierarchy",
] as const;

/** Workspace diagnostics inspection tools. */
export const DIAGNOSTICS_TOOL_IDS = ["read_diagnostics"] as const;

/** Repository blast-radius analysis tools. */
export const CHANGE_IMPACT_TOOL_IDS = [
  "analyze_change_impact",
  "plan_check_change_impact",
] as const;

/** Read-only tools Decision Policy may grant. */
export const READ_ONLY_TOOL_IDS = [
  "describe_tool",
  "list_directory",
  "directory_tree",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  "structural_search",
  ...DIAGNOSTICS_TOOL_IDS,
  "read_git_status",
  "read_git_log",
  "read_git_show",
  "read_git_branches",
  ...CODE_INTELLIGENCE_TOOL_IDS,
  ...CHANGE_IMPACT_TOOL_IDS,
  "emit_review_finding",
  "run_readonly_command",
  "read_package_scripts",
  "sequential_thinking",
  "get_current_time",
  "convert_time",
  "memory_graph_search",
  "memory_graph_open",
] as const;

/** Catalogued network tools — granted only when Decision Policy issues hosts/search. */
export const NETWORK_TOOL_IDS = [
  "fetch_url",
  "fetch_docs",
  "web_search",
] as const;

/**
 * Mutation tools Decision Policy may grant by default.
 * `run_command` is executable but opt-in (explicit grant + commandRules).
 */
export const MUTATION_TOOL_IDS = [
  "apply_patch",
  "delete_file",
  "delete_directory",
  "move_file",
  "memory_graph_update",
] as const;

/** External GitHub write tools (require `gh` auth in the environment). */
export const GITHUB_MUTATION_TOOL_IDS = [
  "create_github_issue",
  "create_pull_request",
] as const;

/**
 * Local git history rewrite tools (DCO / Signed-off-by).
 * Granted on agent execute writes; argv-only, protected-branch guarded.
 */
export const GIT_MUTATION_TOOL_IDS = ["git_signoff_range"] as const;

/** Process tools that may change workspace state through repository scripts. */
export const PROCESS_TOOL_IDS = ["run_command"] as const;

/** Opt-in mutating process tool (not in default MUTATION_TOOL_IDS). */
export const OPT_IN_MUTATION_TOOL_IDS = PROCESS_TOOL_IDS;
