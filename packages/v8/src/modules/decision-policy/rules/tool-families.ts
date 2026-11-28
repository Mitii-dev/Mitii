/**
 * Built-in tool ID families. Decision Policy is the single owner: grants and
 * the Tool Runtime catalog both consume these so they cannot drift (S2C-FAMILIES).
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

/** Family: meta */
export const META_TOOL_IDS = ["describe_tool"] as const;

/** Family: discovery (+ metacognition / memory_read / git_read / review kept in readonly set). */
export const DISCOVERY_TOOL_IDS = [
  "list_directory",
  "directory_tree",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  "structural_search",
] as const;

export const GIT_READ_TOOL_IDS = [
  "read_git_status",
  "read_git_log",
  "read_git_show",
  "read_git_branches",
] as const;

export const REVIEW_TOOL_IDS = ["emit_review_finding"] as const;

export const PROCESS_READ_TOOL_IDS = [
  "run_readonly_command",
  "read_package_scripts",
] as const;

export const METACOGNITION_TOOL_IDS = [
  "sequential_thinking",
  "get_current_time",
  "convert_time",
] as const;

export const MEMORY_READ_TOOL_IDS = [
  "memory_graph_search",
  "memory_graph_open",
] as const;

/** Read-only tools Decision Policy may grant. */
export const READ_ONLY_TOOL_IDS = [
  ...META_TOOL_IDS,
  ...DISCOVERY_TOOL_IDS,
  ...DIAGNOSTICS_TOOL_IDS,
  ...GIT_READ_TOOL_IDS,
  ...CODE_INTELLIGENCE_TOOL_IDS,
  ...CHANGE_IMPACT_TOOL_IDS,
  ...REVIEW_TOOL_IDS,
  ...PROCESS_READ_TOOL_IDS,
  ...METACOGNITION_TOOL_IDS,
  ...MEMORY_READ_TOOL_IDS,
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

/** Named families for plate compilers (S2C-FAMILIES). */
export const TOOL_FAMILIES = {
  meta: META_TOOL_IDS,
  discovery: DISCOVERY_TOOL_IDS,
  diagnostics: DIAGNOSTICS_TOOL_IDS,
  git_read: GIT_READ_TOOL_IDS,
  code_intel: CODE_INTELLIGENCE_TOOL_IDS,
  change_impact: CHANGE_IMPACT_TOOL_IDS,
  review: REVIEW_TOOL_IDS,
  process_read: PROCESS_READ_TOOL_IDS,
  metacognition: METACOGNITION_TOOL_IDS,
  memory_read: MEMORY_READ_TOOL_IDS,
  network: NETWORK_TOOL_IDS,
  mutation: MUTATION_TOOL_IDS,
  github_mutation: GITHUB_MUTATION_TOOL_IDS,
  git_mutation: GIT_MUTATION_TOOL_IDS,
  process_write: PROCESS_TOOL_IDS,
} as const;

export type ToolFamilyId = keyof typeof TOOL_FAMILIES;

export function expandToolFamilies(
  families: readonly ToolFamilyId[],
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const family of families) {
    for (const id of TOOL_FAMILIES[family]) {
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}
