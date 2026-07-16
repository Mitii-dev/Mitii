import { describe, expect, it } from 'vitest';
import { ToolPolicyEngine } from '../../src/core/safety/ToolPolicyEngine';
import { defaultThunderConfig } from '../../src/core/config/defaults';

describe('Git permission policy', () => {
  const engine = new ToolPolicyEngine(defaultThunderConfig().safety, () => false);

  it.each([
    ['git_status', 'allow'],
    ['git_diff', 'allow'],
    ['git_log', 'allow'],
    ['github_draft_pull_request', 'allow'],
    ['github_draft_issue', 'allow'],
    ['github_create_pull_request', 'require_approval'],
    ['github_create_issue', 'require_approval'],
    ['github_dispatch_workflow', 'require_approval'],
    ['git_commit', 'require_approval'],
    ['git_merge', 'require_approval'],
    ['git_rebase', 'require_approval'],
  ] as const)('%s policy is %s', (tool, decision) => {
    expect(engine.evaluate(tool, {}).decision).toBe(decision);
  });

  it('blocks dangerous generic Git commands', () => {
    expect(engine.evaluate('run_command', { command: 'git reset --hard HEAD' }).decision).toBe('block');
    expect(engine.evaluate('run_command', { command: 'git push --force-with-lease' }).decision).toBe('block');
    expect(engine.evaluate('run_command', { command: 'git clean -fdx' }).decision).toBe('block');
  });
});
