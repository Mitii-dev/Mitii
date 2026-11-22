import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { main } from '../src/cli.js';
import { runReviewCommand } from '../src/runReviewCommand.js';
import {
  listGitChangedFiles,
  parseNameStatusZ,
  parsePorcelainZ,
  ReviewGitError,
} from '../src/reviewGit.js';
import type { SessionIo } from '../src/session.js';

function git(cwd: string, ...args: string[]): void {
  execFileSync(
    'git',
    ['-c', 'user.email=t@t.t', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args],
    { cwd, stdio: 'ignore' },
  );
}

function captureIo(): { io: SessionIo; out: string[]; err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return {
    out,
    err,
    io: {
      writeStdout: (c) => void out.push(c),
      writeStderr: (c) => void err.push(c),
      prompt: async () => '',
    },
  };
}

describe('review git parsing', () => {
  it('parses porcelain -z with spaces, renames, and untracked', () => {
    const text = [
      ' M src/a b.ts',
      'R  new name.ts',
      'old name.ts',
      '?? docs/new file.md',
      'D  gone.ts',
      '!! ignored.log',
      '',
    ].join('\0');
    expect(parsePorcelainZ(text)).toEqual([
      { path: 'docs/new file.md', status: 'added', untracked: true },
      { path: 'gone.ts', status: 'deleted' },
      { path: 'new name.ts', status: 'renamed' },
      { path: 'src/a b.ts', status: 'modified' },
    ]);
  });

  it('parses name-status -z including renames', () => {
    const text = ['M', 'a b.ts', 'A', 'c.ts', 'R100', 'old.ts', 'new one.ts', ''].join('\0');
    expect(parseNameStatusZ(text)).toEqual([
      { path: 'a b.ts', status: 'modified' },
      { path: 'c.ts', status: 'added' },
      { path: 'new one.ts', status: 'renamed' },
    ]);
  });
});

describe('mitii review git handling', () => {
  let cwd: string;
  beforeEach(() => {
    cwd = mkdtempSync(join(tmpdir(), 'mitii-cli-review-'));
  });
  afterEach(() => {
    rmSync(cwd, { recursive: true, force: true });
  });

  function initRepo(): void {
    git(cwd, 'init', '-q');
    writeFileSync(join(cwd, 'tracked.txt'), 'one\n');
    git(cwd, 'add', '.');
    git(cwd, 'commit', '-q', '-m', 'init');
  }

  it('exits non-zero with a message when cwd is not a git repository', async () => {
    const { io, out, err } = captureIo();
    const result = await runReviewCommand({ cwd, preview: true, io });
    expect(result.exitCode).toBe(1);
    expect(out.join('')).toBe('');
    expect(err.join('')).toMatch(/mitii review: git status failed/);
    expect(result.payload).toMatchObject({
      error: { code: 'review_git_failed' },
    });
  });

  it('exits non-zero for an unknown commit instead of reporting an empty review', async () => {
    initRepo();
    const { io, err } = captureIo();
    const result = await runReviewCommand({
      cwd,
      mode: 'commit',
      commit: 'deadbeefdeadbeef',
      preview: true,
      io,
    });
    expect(result.exitCode).toBe(1);
    expect(err.join('')).toMatch(/git show failed/);
  });

  it('lists paths with spaces, untracked-as-added, and binary files', async () => {
    initRepo();
    writeFileSync(join(cwd, 'tracked.txt'), 'one\ntwo\n');
    mkdirSync(join(cwd, 'my dir'));
    writeFileSync(join(cwd, 'my dir', 'new file.ts'), 'a\nb\nc\n');
    writeFileSync(join(cwd, 'blob.bin'), Buffer.from([0, 1, 2, 0, 255, 0]));

    const files = await listGitChangedFiles({ cwd, mode: 'workspace' });
    const byPath = new Map(files.map((file) => [file.path, file]));

    expect(byPath.get('tracked.txt')).toMatchObject({
      status: 'modified',
      insertions: 1,
      isBinary: false,
    });
    expect(byPath.get('my dir/new file.ts')).toMatchObject({
      status: 'added',
      insertions: 3,
      isBinary: false,
    });
    expect(byPath.get('my dir/new file.ts')!.diff).toContain('+a');
    expect(byPath.get('blob.bin')).toMatchObject({
      status: 'added',
      isBinary: true,
      insertions: 0,
    });
  });

  it('works before the first commit (no HEAD)', async () => {
    git(cwd, 'init', '-q');
    writeFileSync(join(cwd, 'a.txt'), 'x\n');
    git(cwd, 'add', 'a.txt');
    const files = await listGitChangedFiles({ cwd, mode: 'workspace' });
    expect(files).toHaveLength(1);
    expect(files[0]).toMatchObject({ path: 'a.txt', status: 'added', insertions: 1 });
  });

  it('writes the preview through SessionIo on success', async () => {
    initRepo();
    writeFileSync(join(cwd, 'tracked.txt'), 'one\nmore\n');
    const { io, out, err } = captureIo();
    const result = await runReviewCommand({ cwd, preview: true, io });
    expect(result.exitCode).toBe(0);
    expect(err.join('')).toBe('');
    expect(JSON.parse(out.join(''))).toBeTypeOf('object');
  });

  it('propagates the failure exit code through main()', async () => {
    const { io, err } = captureIo();
    const code = await main(
      ['node', 'mitii', 'review', '--preview', '--cwd', cwd],
      io,
    );
    expect(code).toBe(1);
    expect(err.join('')).toContain('mitii review:');
  });

  it('throws ReviewGitError from listGitChangedFiles outside a repo', async () => {
    await expect(
      listGitChangedFiles({ cwd, mode: 'workspace' }),
    ).rejects.toBeInstanceOf(ReviewGitError);
  });
});
