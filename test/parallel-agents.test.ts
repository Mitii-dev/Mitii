import { existsSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { TaskBoardService } from '../src/core/task';
import { WorktreeService } from '../src/core/git';

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('parallel task foundation', () => {
  it('persists tasks and blocks dependency start until predecessor is done', () => {
    const cwd = tempDir();
    const board = new TaskBoardService(cwd);
    const first = board.add({ title: 'first', prompt: 'do first' });
    const second = board.add({ title: 'second', prompt: 'do second', dependsOn: [first.id] });

    expect(board.list()).toHaveLength(2);
    expect(() => board.transition(second.id, 'running')).toThrow(/blocked/);
    board.transition(first.id, 'done');
    expect(board.transition(second.id, 'running').status).toBe('running');
  });

  it('creates, lists, prunes, and removes git worktrees', async () => {
    const repo = tempGitRepo();
    const service = new WorktreeService(repo);
    const worktree = await service.create({ taskId: 'abc123' });

    expect(existsSync(worktree.path)).toBe(true);
    expect(service.getPath('abc123')).toBe(worktree.path);
    expect(service.prune()).toHaveLength(1);
    await expect(service.remove('abc123', { force: true, deleteBranch: true })).resolves.toBe(true);
    expect(service.list().find((entry) => entry.taskId === 'abc123')?.status).toBe('removed');
  });
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mitii-parallel-'));
  dirs.push(dir);
  return dir;
}

function tempGitRepo(): string {
  const dir = tempDir();
  execFileSync('git', ['init'], { cwd: dir });
  execFileSync('git', ['config', 'user.email', 'mitii@example.test'], { cwd: dir });
  execFileSync('git', ['config', 'user.name', 'Mitii Test'], { cwd: dir });
  execFileSync('git', ['commit', '--allow-empty', '-m', 'init'], { cwd: dir });
  return dir;
}
