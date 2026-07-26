import { isReadOnlyCommand } from '../plans/PlanActEngine';

/**
 * Tools that never mutate workspace files, task/plan state, or trigger a user-facing side
 * effect (approval prompts, external writes) regardless of their arguments. Safe to execute
 * concurrently within a single agent turn — order between them never matters because none
 * of them depends on another's result and none of them writes anything another reads.
 *
 * Deliberately excluded, even though they are "mostly" read-only:
 * - `execute_workspace_script` — some catalog scripts write (checkpoint save, build
 *   diagnostics dump), and the tool name alone doesn't tell us which.
 * - `propose_file_scope` — mutates AgentTaskState's file-scope/quota; subsequent reads in
 *   the same turn may depend on its result.
 * - `spawn_subagent` / `spawn_research_agent` — an `implementer`-type subagent can write
 *   files, and these already manage their own internal concurrency/limits.
 * - `ask_question` — interactive; must not race with or block behind unrelated reads.
 * - anything not in this list, including MCP tools — unaudited by default, conservative.
 */
const PARALLEL_SAFE_TOOLS = new Set([
  'read_file',
  'read_files',
  'resolve_path',
  'list_files',
  'search',
  'search_batch',
  'repo_map',
  'retrieve_context',
  'git_diff',
  'diagnostics',
  'memory_search',
  'project_catalog',
  'analyze_change_impact',
  'analyze_log_directory',
  'analyze_jsonl',
  'query_log_events',
  'list_logs',
  'use_skill',
  'search_script_catalog',
  'fetch_web',
]);

/**
 * Whether a single tool call is safe to run concurrently with other calls in the same round.
 * `run_command` is content-dependent — only commands `isReadOnlyCommand` already classifies
 * as read-only (the same check the approval gate and audit-mode restriction use) qualify.
 */
export function isParallelSafeToolCall(toolName: string, input: Record<string, unknown>): boolean {
  if (toolName === 'run_command') {
    return isReadOnlyCommand(typeof input.command === 'string' ? input.command : '');
  }
  return PARALLEL_SAFE_TOOLS.has(toolName);
}

/**
 * A round of tool calls is only run concurrently when every call in it is independently
 * safe — a single mutating/approval-gated/ordering-sensitive call anywhere in the round
 * falls the whole round back to strictly sequential execution.
 */
export function canParallelizeRound(
  calls: ReadonlyArray<{ name: string; input: Record<string, unknown> }>
): boolean {
  return calls.length > 1 && calls.every((call) => isParallelSafeToolCall(call.name, call.input));
}
