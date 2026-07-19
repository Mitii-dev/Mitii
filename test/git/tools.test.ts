import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { createGitLogTool, createGitStatusTool, createStructuredGitDiffTool } from '../../src/features/ce/git/tools/gitTools';

describe('structured Git tools', () => {
  it('returns structured status, diff, and log from a real repository', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mitii-git-tools-'));
    try {
      execFileSync('git', ['init'], { cwd: dir });
      execFileSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      execFileSync('git', ['config', 'user.name', 'Test User'], { cwd: dir });
      mkdirSync(join(dir, 'src'));
      writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 1;\n');
      execFileSync('git', ['add', 'src/index.ts'], { cwd: dir });
      execFileSync('git', ['commit', '-m', 'feat: add index'], { cwd: dir });
      writeFileSync(join(dir, 'src', 'index.ts'), 'export const a = 2;\n');

      const status = JSON.parse((await createGitStatusTool(dir).execute({})).output);
      expect(status.unstagedFiles).toContain('src/index.ts');

      const diff = JSON.parse((await createStructuredGitDiffTool(dir).execute({ kind: 'unstaged' })).output);
      expect(diff.fileSummaries[0].path).toBe('src/index.ts');

      const log = JSON.parse((await createGitLogTool(dir).execute({ limit: 5 })).output);
      expect(log[0].subject).toBe('feat: add index');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
