import { describe, expect, it } from 'vitest';
import { buildRuntime } from '../../../src/kernel/bootstrap';
import { ceFeatureModules } from '../../../src/features/ce/featureModules';

/**
 * Locks in exactly which tool ids the CE `FeatureModule`s register through `buildRuntime()`,
 * cross-checked by hand against every `this.toolRuntime.register(create...)` /
 * `for (const tool of create...Tools(...))` line in `ThunderController.createChatOrchestrator()`
 * (the ground truth for what a real session actually exposes today).
 *
 * `ThunderController` itself still hand-registers tools directly — this suite does not exercise
 * it — but this is the parity check that must stay green before that hand-wiring can safely be
 * replaced with `buildRuntime()` + resolving these factories. See the migration plan doc.
 *
 * One real, pre-existing bug this test documents rather than reproduces: `ThunderController`
 * registers both `createGitDiffTool` and `createStructuredGitDiffTool` under the same name
 * (`git_diff`); the second silently overwrites the first via `ToolRuntime.register()`'s
 * duplicate-tolerant behavior, so `createGitDiffTool` has never actually been reachable. Only the
 * structured version is registered here.
 */
describe('CE tool factory registration parity with ThunderController', () => {
  const runtime = buildRuntime({
    features: ceFeatureModules,
    hostPorts: { workspace: { workspaceRoot: '/tmp/workspace', readText: async () => '', writeText: async () => {} } },
  });
  const ids = runtime.registries.tools.list().map((f) => f.id).sort();

  it('registers no duplicate ids', () => {
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('matches the exact set of tools ThunderController hand-registers today', () => {
    const expected = [
      // filesystem
      'read_file', 'read_files', 'list_files', 'resolve_path', 'write_file', 'apply_patch',
      'search', 'search_batch', 'search_script_catalog', 'execute_workspace_script',
      // git
      'git_status', 'git_diff', 'git_log', 'git_show', 'git_blame', 'git_compare_branches',
      'git_stage_files', 'git_unstage_files', 'git_commit', 'git_branch_create', 'git_branch_switch',
      'git_branch_delete', 'git_merge', 'git_rebase',
      'git_tag_list', 'git_tag_create', 'git_tag_delete_local',
      'detect_changelog_strategy', 'aggregate_changelog', 'generate_changelog_patch',
      'discover_github_workflows', 'analyze_github_workflow', 'github_dispatch_workflow', 'github_get_workflow_run',
      'github_verify_repository', 'github_draft_pull_request', 'github_create_pull_request', 'github_draft_issue',
      'github_find_duplicate_issues', 'github_create_issue', 'github_create_release',
      'release_plan_controller',
      // context / retrieval
      'repo_map', 'retrieve_context',
      // memory
      'memory_search', 'memory_write', 'save_task_state',
      // skills
      'use_skill',
      // audit
      'analyze_log_directory', 'analyze_jsonl', 'query_log_events', 'list_logs',
      // ask mode
      'ask_question', 'diagnostics', 'project_catalog', 'analyze_change_impact', 'propose_file_scope',
      // agent mode
      'run_command', 'fetch_web', 'spawn_subagent', 'spawn_research_agent',
      // plan mode
      'mark_step_complete', 'propose_plan_mutation',
    ].sort();

    expect(ids).toEqual(expected);
  });
});
