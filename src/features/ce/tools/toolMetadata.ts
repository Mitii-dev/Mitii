/**
 * Authoritative built-in tool metadata — effects, mode allowlists, and policy helpers.
 * Consumers should query these sets instead of maintaining parallel name lists.
 */
import { ToolId, WORKSPACE_WRITE_TOOL_IDS } from './toolIds';

export type ToolEffect =
  | 'pure'
  | 'workspace-read'
  | 'workspace-write'
  | 'process-execution'
  | 'network-read'
  | 'memory-read'
  | 'memory-write'
  | 'task-state-write'
  | 'plan-state-write'
  | 'interactive';

/** Tools allowed during plan discovery (read-only exploration). */
export const PLANNING_DISCOVERY_TOOL_IDS = new Set<string>([
  ToolId.ReadFile,
  ToolId.ReadFiles,
  'resolve_path',
  'list_files',
  'search',
  'search_batch',
  'search_script_catalog',
  ToolId.UseSkill,
  'repo_map',
  'retrieve_context',
  ToolId.GitDiff,
  ToolId.Diagnostics,
  ToolId.MemorySearch,
  ToolId.RunCommand,
  ToolId.SpawnResearchAgent,
  ToolId.SpawnSubagent,
  ToolId.FetchWeb,
  ToolId.AskQuestion,
  ToolId.ProposeFileScope,
]);

/** Tools available during plan step execution (includes writes and plan control). */
export const PLAN_EXECUTION_TOOL_IDS = new Set<string>([
  ...PLANNING_DISCOVERY_TOOL_IDS,
  ToolId.WriteFile,
  ToolId.ApplyPatch,
  ToolId.ExecuteWorkspaceScript,
  ToolId.MemoryWrite,
  'save_task_state',
  'mark_step_complete',
  'propose_plan_mutation',
]);

/** Read-only tools exposed in Ask mode (shell/subagent tools are approval-gated at execution). */
export const ASK_ALLOWED_TOOL_IDS = new Set<string>([
  ToolId.ReadFile,
  ToolId.ReadFiles,
  'resolve_path',
  'list_files',
  'search',
  'search_batch',
  'repo_map',
  'retrieve_context',
  ToolId.GitDiff,
  ToolId.Diagnostics,
  ToolId.MemorySearch,
  ToolId.RunCommand,
  ToolId.ExecuteWorkspaceScript,
  'search_script_catalog',
  ToolId.UseSkill,
  ToolId.FetchWeb,
  ToolId.AskQuestion,
  ToolId.SpawnResearchAgent,
  ToolId.SpawnSubagent,
  ToolId.ProposeFileScope,
  'project_catalog',
  'analyze_change_impact',
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
  'list_logs',
]);

/** Tools whose successful output can ground an Ask-mode answer. */
export const ASK_GROUNDING_TOOL_IDS = new Set<string>([
  ToolId.ReadFile,
  ToolId.ReadFiles,
  'resolve_path',
  'search',
  'search_batch',
  'retrieve_context',
  'repo_map',
  'list_files',
  ToolId.GitDiff,
  ToolId.Diagnostics,
  'project_catalog',
  'analyze_change_impact',
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
  'list_logs',
]);

/** Plan mode = discovery tools plus analysis helpers. */
export const PLAN_ALLOWED_TOOL_IDS = new Set<string>([
  ...PLANNING_DISCOVERY_TOOL_IDS,
  'project_catalog',
  'analyze_change_impact',
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
  'list_logs',
]);

export const PLAN_GROUNDING_TOOL_IDS = new Set<string>([
  ...PLANNING_DISCOVERY_TOOL_IDS,
  'project_catalog',
  'analyze_change_impact',
]);

/** Tools safe to run concurrently when arguments are also safe (run_command is special-cased). */
export const PARALLEL_SAFE_TOOL_IDS = new Set<string>([
  ToolId.ReadFile,
  ToolId.ReadFiles,
  'resolve_path',
  'list_files',
  'search',
  'search_batch',
  'repo_map',
  'retrieve_context',
  ToolId.GitDiff,
  ToolId.Diagnostics,
  ToolId.MemorySearch,
  'project_catalog',
  'analyze_change_impact',
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
  'list_logs',
  ToolId.UseSkill,
  'search_script_catalog',
  ToolId.FetchWeb,
]);

/** Tools that may produce verification evidence when they succeed with verification intent. */
export const VERIFICATION_TOOL_IDS = new Set<string>([
  ToolId.RunCommand,
  ToolId.Diagnostics,
  ToolId.ExecuteWorkspaceScript,
]);

/** Read-only research subagent tool surface (run_command filtered at execution). */
export const RESEARCH_AGENT_TOOL_IDS = new Set<string>([
  ToolId.ReadFile,
  ToolId.ReadFiles,
  'resolve_path',
  'list_files',
  'search',
  'search_batch',
  'repo_map',
  'retrieve_context',
  ToolId.GitDiff,
  ToolId.Diagnostics,
  ToolId.MemorySearch,
  ToolId.RunCommand,
]);

export const PLAN_CONTROL_TOOL_IDS = new Set<string>([
  'mark_step_complete',
  'propose_plan_mutation',
]);

export { WORKSPACE_WRITE_TOOL_IDS as WRITE_TOOL_IDS };

export function isWorkspaceWriteTool(toolName: string): boolean {
  return WORKSPACE_WRITE_TOOL_IDS.has(toolName);
}

export function isVerificationTool(toolName: string): boolean {
  return VERIFICATION_TOOL_IDS.has(toolName);
}

export function isParallelSafeToolName(toolName: string): boolean {
  return PARALLEL_SAFE_TOOL_IDS.has(toolName);
}

// --- Safety / approval policy (ToolPolicyEngine) ---

/** Built-in tools treated as read-only for approval policy (excludes shell and workspace writes). */
export const POLICY_READ_ONLY_TOOL_IDS = new Set<string>([
  ...PARALLEL_SAFE_TOOL_IDS,
  ToolId.SpawnResearchAgent,
  ToolId.SpawnSubagent,
  ToolId.ProposeFileScope,
  ToolId.AskQuestion,
  ToolId.ExecuteWorkspaceScript,
  'save_task_state',
  ...PLAN_CONTROL_TOOL_IDS,
  'git_status',
  'git_log',
  'git_show',
  'git_blame',
  'git_compare_branches',
  'git_tag_list',
  'detect_changelog_strategy',
  'aggregate_changelog',
  'discover_github_workflows',
  'analyze_github_workflow',
  'github_verify_repository',
  'github_draft_pull_request',
  'github_draft_issue',
  'github_find_duplicate_issues',
  'github_get_workflow_run',
]);

export const PATH_READ_TOOL_IDS = new Set<string>([
  ToolId.ReadFile,
  ToolId.ReadFiles,
  'list_files',
  'resolve_path',
]);

export const LOG_AUDIT_PATH_TOOL_IDS = new Set<string>([
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
]);

export const SHELL_TOOL_IDS = new Set<string>([ToolId.RunCommand]);

export const GIT_POLICY_WRITE_TOOL_IDS = new Set<string>([
  'git_stage_files',
  'git_unstage_files',
  'generate_changelog_patch',
  'git_branch_create',
  'git_branch_switch',
]);

export const GIT_EXPLICIT_APPROVAL_TOOL_IDS = new Set<string>([
  'git_commit',
  'git_branch_delete',
  'git_merge',
  'git_rebase',
  'git_tag_create',
  'git_tag_delete_local',
  'github_create_pull_request',
  'github_create_issue',
  'github_dispatch_workflow',
  'github_create_release',
  'release_plan_controller',
]);

/** MCP filesystem tools that duplicate Mitii builtins (capability routing). */
export const MCP_FILESYSTEM_TOOL_IDS = [
  'mcp__filesystem__read_text_file',
  'mcp__filesystem__read_multiple_files',
  'mcp__filesystem__read_media_file',
  'mcp__filesystem__read_file',
  'mcp__filesystem__list_directory',
  'mcp__filesystem__directory_tree',
  'mcp__filesystem__search_files',
  'mcp__filesystem__get_file_info',
  'mcp__filesystem__list_allowed_directories',
  'mcp__filesystem__create_directory',
  'mcp__filesystem__move_file',
  'mcp__filesystem__write_file',
  'mcp__filesystem__edit_file',
] as const;

export const MCP_FILESYSTEM_WRITE_PATTERN =
  /^mcp__filesystem__(create_directory|move_file|write_file|edit_file)$/i;

/** Subagent read surface shared by research/reviewer/implementer builtins. */
export const SUBAGENT_READ_TOOL_IDS = [...RESEARCH_AGENT_TOOL_IDS] as const;

/** Git-domain read tools (safe on any git route). */
export const GIT_READ_TOOL_IDS = [
  'discover_github_workflows',
  'analyze_github_workflow',
  'github_get_workflow_run',
  'github_verify_repository',
  'github_find_duplicate_issues',
] as const;

export const GIT_WRITE_TOOL_IDS = [
  'git_stage_files',
  'git_unstage_files',
  'git_commit',
  'git_branch_create',
  'git_branch_switch',
  'git_branch_delete',
  'git_merge',
  'git_rebase',
  'git_tag_create',
  'git_tag_delete_local',
  'detect_changelog_strategy',
  'aggregate_changelog',
  'generate_changelog_patch',
  'github_dispatch_workflow',
  'github_draft_pull_request',
  'github_create_pull_request',
  'github_draft_issue',
  'github_create_issue',
] as const;

export const RELEASE_TOOL_IDS = [
  'release_plan_controller',
  'github_create_release',
] as const;

export function isMcpFilesystemWriteToolName(toolName: string): boolean {
  return MCP_FILESYSTEM_WRITE_PATTERN.test(toolName);
}

export function isMcpFilesystemReadToolName(toolName: string): boolean {
  if (!toolName.startsWith('mcp__filesystem__')) return false;
  return !isMcpFilesystemWriteToolName(toolName);
}

export function usesReadPathSemanticsTool(toolName: string): boolean {
  return (
    PATH_READ_TOOL_IDS.has(toolName) ||
    LOG_AUDIT_PATH_TOOL_IDS.has(toolName) ||
    toolName === ToolId.ProposeFileScope ||
    isMcpFilesystemReadToolName(toolName)
  );
}
