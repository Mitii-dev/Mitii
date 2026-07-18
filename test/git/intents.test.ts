import { describe, expect, it } from 'vitest';
import {
  GIT_INTENTS,
  GIT_INTENT_METADATA,
  GitNoProgressTracker,
  approvalForGitOperation,
  canonicalGitActionSignature,
  classifyGitIntent,
  decomposeCompositeGitTask,
  resolveGitRoute,
  toolsForGitRoute,
} from '../../src/core/git/intents';

describe('Git intent metadata and routing', () => {
  it('defines metadata for every Git intent', () => {
    for (const intent of GIT_INTENTS) {
      const meta = GIT_INTENT_METADATA[intent];
      expect(meta.intent).toBe(intent);
      expect(meta.approval).toMatch(/^(none|policy|explicit|always_explicit)$/);
      expect(meta.readOnly || meta.workspaceWrite || meta.localGitWrite || meta.remoteWrite).toBe(true);
    }
  });

  it.each([
    ['Generate a commit message', 'git_commit_message', false, false],
    ['Commit these changes', 'git_commit', true, false],
    ['Draft a PR', 'github_pr_draft', false, false],
    ['Create a PR', 'github_pr_create', false, true],
    ['Write an issue', 'github_issue_draft', false, false],
    ['Open this issue on GitHub', 'github_issue_create', false, true],
    ['Analyze workflow', 'github_workflow_analyze', false, false],
    ['Run workflow', 'github_workflow_dispatch', false, true],
    ['Update CHANGELOG', 'git_changelog_update', false, false],
  ] as const)('classifies %s', (message, expectedIntent, requiresGitWrite, requiresRemoteWrite) => {
    const classification = classifyGitIntent(message);
    expect(classification.primaryIntent).toBe(expectedIntent);
    expect(classification.requiresGitWrite).toBe(requiresGitWrite);
    expect(classification.requiresRemoteWrite).toBe(requiresRemoteWrite);
  });

  it('does not treat Log viewer / app logs as git history analysis', () => {
    const message =
      'What all things needs for build a Log viewer UI for\n/Users/karthikshinde/Applications/resumeAI/.mitii/logs';
    const classification = classifyGitIntent(message);
    expect(classification.primaryIntent).not.toBe('git_history_analysis');
    const route = resolveGitRoute(message, 'plan');
    expect(route.isGitTask).toBe(false);
    expect(route.selectedSkills.injected).not.toContain('git-history-analysis');
  });

  it('still classifies explicit git log / history requests', () => {
    expect(classifyGitIntent('show git log for the last 10 commits').primaryIntent).toBe(
      'git_history_analysis'
    );
    expect(resolveGitRoute('show git log for the last 10 commits').isGitTask).toBe(true);
  });

  it('selects route-specific tool exposure without draft tools mutating remotes', () => {
    const draftRoute = resolveGitRoute('Draft a PR for this branch');
    expect(draftRoute.route).toBe('github_remote_write');
    expect(draftRoute.allowedTools).toContain('github_draft_pull_request');
    expect(draftRoute.allowedTools).not.toContain('github_create_pull_request');

    expect(toolsForGitRoute('git_commit_message', 'git_commit_message')).toEqual(['git_status', 'git_diff', 'git_log']);
  });

  it('maps approval matrix for high-risk operations', () => {
    expect(approvalForGitOperation('git_commit_message')).toBe('none');
    expect(approvalForGitOperation('git_commit')).toBe('explicit');
    expect(approvalForGitOperation('github_pr_merge')).toBe('always_explicit');
    expect(approvalForGitOperation('git_force_push')).toBe('always_explicit');
  });

  it('decomposes composite Git requests into staged routes', () => {
    const stages = decomposeCompositeGitTask('Update the changelog, commit, push, and create a PR');
    expect(stages.map((stage) => stage.intent)).toEqual(['git_changelog_update', 'git_commit', 'github_pr_create']);
    expect(stages[0].allowedTools).toContain('generate_changelog_patch');
  });

  it('creates stable action signatures and detects no progress', () => {
    const first = canonicalGitActionSignature('github_pr', { head: 'feature/a', base: 'main' });
    const second = canonicalGitActionSignature('github_pr', { base: 'main', head: 'feature/a' });
    expect(first).toBe(second);
    const tracker = new GitNoProgressTracker();
    expect(tracker.record(first).shouldStop).toBe(false);
    expect(tracker.record(first).shouldStop).toBe(false);
    expect(tracker.record(first).shouldStop).toBe(true);
  });
});
