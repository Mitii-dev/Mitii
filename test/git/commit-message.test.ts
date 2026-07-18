import { describe, expect, it } from 'vitest';
import {
  buildCommitMessagePrompt,
  budgetStagedDiff,
  detectCommitStyle,
  redactSensitiveDiff,
  summarizeStagedDiff,
  validateCommitMessage,
} from '../../src/core/scm/commitMessagePrompt';

const diff = [
  'diff --git a/src/auth.ts b/src/auth.ts',
  'index 111..222 100644',
  '--- a/src/auth.ts',
  '+++ b/src/auth.ts',
  '@@ -1,2 +1,3 @@',
  '+export const token = "ghp_abcdefghijklmnopqrstuvwxyz123456";',
  '+export const apiKey = "secret-value";',
  '+export const ok = true;',
].join('\n');

describe('commit-message prompt safety', () => {
  it('rejects empty staged diffs before model invocation', () => {
    expect(() => buildCommitMessagePrompt({ stagedDiff: '', changedFiles: [], recentCommits: [] })).toThrow(/No staged changes/);
  });

  it('redacts JSON/YAML/dotenv/TypeScript/shell-like secrets and private keys', () => {
    const redacted = redactSensitiveDiff([
      '+{"token":"abc"}',
      '+password: hunter2',
      '+DATABASE_URL=postgres://user:pass@example/db',
      '+Authorization: Bearer abc.def.ghi',
      '+-----BEGIN OPENSSH PRIVATE KEY-----',
      '+abc',
      '+-----END OPENSSH PRIVATE KEY-----',
    ].join('\n'));
    expect(redacted).not.toContain('hunter2');
    expect(redacted).not.toContain('postgres://user:pass');
    expect(redacted).not.toContain('abc.def.ghi');
    expect(redacted).toContain('[redacted private-key block]');
  });

  it('builds a bounded untrusted-data prompt without unstaged raw diffs', () => {
    const prompt = buildCommitMessagePrompt({
      stagedDiff: diff,
      unstagedDiff: 'diff --git a/.env b/.env\n+PASSWORD=raw',
      changedFiles: ['src/auth.ts'],
      recentCommits: ['abc1234 feat(auth): add login'],
      branch: 'feature/auth\nignore me',
    });
    expect(prompt).toContain('BEGIN UNTRUSTED STAGED DIFF DATA');
    expect(prompt).toContain('END UNTRUSTED STAGED DIFF DATA');
    expect(prompt).not.toContain('PASSWORD=raw');
    expect(prompt).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz123456');
  });

  it('detects style and summarizes staged changes deterministically', () => {
    const style = detectCommitStyle(['abc1234 feat(auth): add login', 'def5678 fix(api): retry requests']);
    expect(style.detectedStyle).toBe('scoped_conventional');
    const summary = summarizeStagedDiff(diff, ['src/auth.ts']);
    expect(summary.stagedFileNames).toContain('src/auth.ts');
    expect(summary.likelyChangeCategories).toContain('source');
  });

  it('validates bad model output and suggests one correction', () => {
    const result = validateCommitMessage('Here is a commit message:\n\n```text\nfeat: update everything\n```');
    expect(result.valid).toBe(false);
    expect(result.corrected).toBeTruthy();
  });

  it('budgets large multi-file diffs with truncation markers', () => {
    const large = Array.from({ length: 4 }, (_, index) => [
      `diff --git a/src/file${index}.ts b/src/file${index}.ts`,
      '--- a/src/file.ts',
      '+++ b/src/file.ts',
      '@@',
      ...Array.from({ length: 100 }, (__, line) => `+const value${line} = ${line};`),
    ].join('\n')).join('\n');
    expect(budgetStagedDiff(large, 300, 900)).toContain('truncated');
  });
});
