import { describe, expect, it } from 'vitest';
import { isParallelSafeToolCall, canParallelizeRound } from '../src/features/ce/runtime/toolConcurrency';

describe('toolConcurrency', () => {
  it('marks pure read tools as parallel-safe', () => {
    for (const name of [
      'read_file', 'read_files', 'resolve_path', 'list_files', 'search', 'search_batch',
      'repo_map', 'retrieve_context', 'git_diff', 'diagnostics', 'memory_search',
      'project_catalog', 'analyze_change_impact', 'analyze_log_directory', 'analyze_jsonl',
      'query_log_events', 'list_logs', 'use_skill', 'search_script_catalog', 'fetch_web',
    ]) {
      expect(isParallelSafeToolCall(name, {})).toBe(true);
    }
  });

  it('excludes writes, approval-gated, and ordering-sensitive tools', () => {
    for (const name of [
      'write_file', 'apply_patch', 'memory_write', 'save_task_state',
      'propose_file_scope', 'spawn_subagent', 'spawn_research_agent', 'ask_question',
      'execute_workspace_script', 'mark_step_complete', 'propose_plan_mutation',
    ]) {
      expect(isParallelSafeToolCall(name, {})).toBe(false);
    }
  });

  it('treats run_command as safe only when the command itself is read-only', () => {
    expect(isParallelSafeToolCall('run_command', { command: 'git status' })).toBe(true);
    expect(isParallelSafeToolCall('run_command', { command: 'rg "TODO" src' })).toBe(true);
    expect(isParallelSafeToolCall('run_command', { command: 'rm -rf node_modules' })).toBe(false);
    expect(isParallelSafeToolCall('run_command', { command: 'npm install lodash' })).toBe(false);
    expect(isParallelSafeToolCall('run_command', {})).toBe(false);
  });

  it('excludes unaudited/MCP tool names by default', () => {
    expect(isParallelSafeToolCall('mcp__filesystem__read_file', {})).toBe(false);
    expect(isParallelSafeToolCall('some_unknown_tool', {})).toBe(false);
  });

  it('only parallelizes a round when every call in it is independently safe', () => {
    expect(canParallelizeRound([
      { name: 'read_file', input: {} },
      { name: 'search', input: {} },
    ])).toBe(true);

    expect(canParallelizeRound([
      { name: 'read_file', input: {} },
      { name: 'write_file', input: {} },
    ])).toBe(false);

    expect(canParallelizeRound([
      { name: 'read_file', input: {} },
      { name: 'run_command', input: { command: 'npm install' } },
    ])).toBe(false);
  });

  it('does not bother parallelizing a single-call round', () => {
    expect(canParallelizeRound([{ name: 'read_file', input: {} }])).toBe(false);
    expect(canParallelizeRound([])).toBe(false);
  });
});
