import { describe, expect, it } from 'vitest';
import { aggregateChangelog, detectChangelogStrategy, generateChangelogPatch } from '../../src/features/ce/git/changelog';
import { buildIssueDraft, buildPullRequestDraft, findDuplicateIssues, parseGitHubRemoteUrl, verifyGitHubRepository } from '../../src/features/ce/git/github';
import { analyzeGitHubWorkflow, workflowMayAffectProduction } from '../../src/features/ce/git/workflows';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

describe('GitHub and release helpers', () => {
  it('verifies GitHub repositories and drafts PRs/issues without publishing', () => {
    expect(parseGitHubRemoteUrl('git@github.com:owner/repo.git')).toMatchObject({ owner: 'owner', name: 'repo' });
    expect(verifyGitHubRepository({ remoteUrl: 'https://github.com/owner/repo.git', authenticatedUser: 'me', writePermission: true }).ok).toBe(true);
    const pr = buildPullRequestDraft({ base: 'main', head: 'feature/a', commits: ['abc1234 feat: add thing'], changedFiles: ['src/a.ts'] });
    expect(pr.title).toContain('feat: add thing');
    const issue = buildIssueDraft({ kind: 'bug', title: 'Crash on load', report: 'App should not crash' });
    expect(issue.labels).toContain('bug');
  });

  it('detects duplicate issues', () => {
    const duplicates = findDuplicateIssues(
      { title: 'Crash on loading project', body: 'Error: cannot read config' },
      [{ number: 1, title: 'Crash on loading project', body: 'Error: cannot read config' }]
    );
    expect(duplicates[0].confidence).toBeGreaterThan(0.9);
  });

  it('detects changelog strategy and generates focused patch previews', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-changelog-'));
    try {
      writeFileSync(join(dir, 'package.json'), '{"version":"1.2.3"}');
      writeFileSync(join(dir, 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n');
      expect(detectChangelogStrategy(dir).strategy).toBe('keep_a_changelog');
      const aggregation = aggregateChangelog(['abc1234 feat(ui): add panel (#4)', 'def5678 fix: avoid crash']);
      const patch = generateChangelogPatch('# Changelog\n\n## [Unreleased]\n\n', aggregation);
      expect(patch.preview).toContain('Added');
      expect(patch.preview).toContain('Fixed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('analyzes GitHub Actions workflow risks', () => {
    const findings = analyzeGitHubWorkflow([
      'name: CI',
      'on: pull_request_target',
      'permissions: write-all',
      'jobs:',
      '  test:',
      '    runs-on: ubuntu-latest',
      '    steps:',
      '      - uses: actions/checkout@main',
      '      - run: echo ${{ github.event.pull_request.title }}',
    ].join('\n'));
    expect(findings.map((finding) => finding.code)).toContain('pull_request_target_risk');
    expect(findings.map((finding) => finding.code)).toContain('excessive_permissions');
    expect(workflowMayAffectProduction('deploy production')).toBe(true);
  });
});
