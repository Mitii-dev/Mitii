import { describe, expect, it } from 'vitest';
import { resolveActSkillNames } from '../src/core/modes/agent/actSkillRouting';
import { resolveGitRoute } from '../src/core/git/intents';

describe('actSkillRouting', () => {
  it('injects Git route skill (0–1) for commit message requests', () => {
    const gitRoute = resolveGitRoute('generate a commit message for my staged changes', 'agent');
    const names = resolveActSkillNames('feature', {
      kind: 'git',
      complexity: 'low',
      summary: 'generate a commit message for my staged changes',
      shouldPlan: false,
      shouldVerify: false,
      shouldUseSubagents: false,
      gitRoute,
    });
    expect(names).toContain('git-commit-message');
    expect(names).toHaveLength(1);
    expect(names).not.toContain('using-agent-skills');
  });

  it('keeps log-audit exclusive for log audits', () => {
    const names = resolveActSkillNames('log_audit', {
      kind: 'log_audit',
      complexity: 'medium',
      summary: 'analyze these logs',
      shouldPlan: false,
      shouldVerify: true,
      shouldUseSubagents: false,
    });
    expect(names).toEqual(['log-audit']);
  });

  it('routes code review and performance as active skills', () => {
    expect(
      resolveActSkillNames('feature', {
        kind: 'implementation',
        complexity: 'medium',
        summary: 'Please review this PR for quality gates',
        shouldPlan: false,
        shouldVerify: true,
        shouldUseSubagents: false,
      })
    ).toContain('code-review-and-quality');

    expect(
      resolveActSkillNames('feature', {
        kind: 'implementation',
        complexity: 'medium',
        summary: 'Fix Core Web Vitals and bundle size regression',
        shouldPlan: false,
        shouldVerify: true,
        shouldUseSubagents: false,
      })
    ).toContain('performance-optimization');
  });

  it('injects documentation skill for docs, not meta or TDD', () => {
    const names = resolveActSkillNames('docs', {
      kind: 'docs',
      complexity: 'medium',
      summary: 'Create enterprise-level README files for ai-service and frontend',
      shouldPlan: true,
      shouldVerify: true,
      shouldUseSubagents: false,
      docsSubtype: 'readme',
    });
    expect(names).toEqual(['documentation']);
    expect(names).not.toContain('using-agent-skills');
    expect(names).not.toContain('test-driven-development');
  });
});
