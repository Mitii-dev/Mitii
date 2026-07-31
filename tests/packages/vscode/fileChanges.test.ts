import { afterEach, describe, expect, it } from 'vitest';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RunEvent } from '@mitii/sdk';

import {
  buildPatchPreview,
  buildRunFileChangesView,
  collectMutatedPathsFromEvent,
  countLineDiff,
  createFileChangeRunSnapshot,
  noteMutatedPaths,
  noteMutatedPathsFromEvent,
  parsePathsFromToolSummary,
  undoRunFileChanges,
} from '../../../apps/vscode/src/fileChanges.ts';
import {
  inlineCodeAsFileRef,
  looksLikeWorkspaceFileRef,
  parseFileRef,
} from '../../../apps/vscode/src/fileLinks.ts';

describe('fileChanges', () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('parses paths from tool summaries', () => {
    expect(parsePathsFromToolSummary('patches=2 paths=a.ts,b.ts')).toEqual([
      'a.ts',
      'b.ts',
    ]);
    expect(parsePathsFromToolSummary('paths=none')).toEqual([]);
    expect(parsePathsFromToolSummary(undefined)).toEqual([]);
    expect(parsePathsFromToolSummary('path=apps/vscode/src/foo.ts')).toEqual([
      'apps/vscode/src/foo.ts',
    ]);
    expect(
      parsePathsFromToolSummary('from=apps/a.ts to=apps/b.ts'),
    ).toEqual(['apps/a.ts', 'apps/b.ts']);
  });

  it('collects mutated paths from apply_patch events', () => {
    const started = {
      type: 'tool_started',
      runId: 'r1',
      callId: 'c1',
      toolName: 'apply_patch',
      summary: 'patches=1 paths=apps/vscode/src/foo.ts',
      at: '2026-07-28T00:00:00.000Z',
    } as RunEvent;
    expect(collectMutatedPathsFromEvent(started)).toEqual([
      'apps/vscode/src/foo.ts',
    ]);

    const failed = {
      type: 'tool_completed',
      runId: 'r1',
      callId: 'c1',
      toolName: 'apply_patch',
      status: 'failed',
      summary: 'patches=1 paths=apps/vscode/src/foo.ts',
      at: '2026-07-28T00:00:00.000Z',
    } as RunEvent;
    expect(collectMutatedPathsFromEvent(failed)).toEqual([]);
  });

  it('collects mutated paths from delete_file and move_file events', () => {
    expect(
      collectMutatedPathsFromEvent({
        type: 'tool_started',
        runId: 'r1',
        callId: 'c1',
        toolName: 'delete_file',
        summary: 'path=src/gone.ts',
        at: '2026-07-28T00:00:00.000Z',
      } as RunEvent),
    ).toEqual(['src/gone.ts']);

    expect(
      collectMutatedPathsFromEvent({
        type: 'tool_completed',
        runId: 'r1',
        callId: 'c2',
        toolName: 'move_file',
        status: 'succeeded',
        summary: 'from=src/old.ts to=src/new.ts',
        at: '2026-07-28T00:00:00.000Z',
      } as RunEvent),
    ).toEqual(['src/old.ts', 'src/new.ts']);
  });

  it('counts line additions and deletions', () => {
    expect(countLineDiff('a\nb\n', 'a\nc\n')).toEqual({
      additions: 1,
      deletions: 1,
    });
    expect(countLineDiff(null, 'x\ny\n')).toEqual({
      additions: 2,
      deletions: 0,
    });
    expect(countLineDiff('x\n', null)).toEqual({
      additions: 0,
      deletions: 1,
    });
  });

  it('builds a run file-changes view and supports undo', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-file-changes-'));
    dirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/a.ts'), 'one\n', 'utf8');

    const snapshot = createFileChangeRunSnapshot(['src/dirty.ts']);
    noteMutatedPaths(snapshot, root, ['src/a.ts']);
    writeFileSync(join(root, 'src/a.ts'), 'one\ntwo\n', 'utf8');

    const view = buildRunFileChangesView({
      runId: 'run_1',
      workspaceRoot: root,
      snapshot,
    });
    expect(view).not.toBeNull();
    expect(view!.files).toHaveLength(1);
    expect(view!.files[0]!.path).toBe('src/a.ts');
    expect(view!.files[0]!.additions).toBe(1);
    expect(view!.totalAdditions).toBe(1);
    expect(view!.leftUntouchedPreDirty).toBe(1);

    const undone = undoRunFileChanges({ workspaceRoot: root, snapshot });
    expect(undone.restored).toEqual(['src/a.ts']);
    expect(readFileSync(join(root, 'src/a.ts'), 'utf8')).toBe('one\n');
  });

  it('snapshots on tool_started before mutation', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-file-changes-'));
    dirs.push(root);
    writeFileSync(join(root, 'f.ts'), 'before\n', 'utf8');
    const snapshot = createFileChangeRunSnapshot();
    noteMutatedPathsFromEvent(snapshot, root, {
      type: 'tool_started',
      runId: 'r',
      callId: 'c',
      toolName: 'apply_patch',
      summary: 'paths=f.ts',
      at: '2026-07-28T00:00:00.000Z',
    } as RunEvent);
    writeFileSync(join(root, 'f.ts'), 'after\n', 'utf8');
    const view = buildRunFileChangesView({
      runId: 'r',
      workspaceRoot: root,
      snapshot,
    });
    expect(view!.files[0]!.patchPreview).toContain('-before');
    expect(view!.files[0]!.patchPreview).toContain('+after');
  });

  it('builds a truncated patch preview', () => {
    const preview = buildPatchPreview('x.ts', 'a\n', 'b\n', 40);
    expect(preview).toContain('--- a/x.ts');
    expect(preview.length).toBeLessThanOrEqual(42);
  });

  it('undoes delete_file and move_file using tool_started snapshots', () => {
    const root = mkdtempSync(join(tmpdir(), 'mitii-file-changes-'));
    dirs.push(root);
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(join(root, 'src/keep.ts'), 'keep\n', 'utf8');
    writeFileSync(join(root, 'src/old.ts'), 'moved\n', 'utf8');

    const snapshot = createFileChangeRunSnapshot();
    noteMutatedPathsFromEvent(snapshot, root, {
      type: 'tool_started',
      runId: 'r',
      callId: 'c1',
      toolName: 'delete_file',
      summary: 'path=src/keep.ts',
      at: '2026-07-28T00:00:00.000Z',
    } as RunEvent);
    noteMutatedPathsFromEvent(snapshot, root, {
      type: 'tool_started',
      runId: 'r',
      callId: 'c2',
      toolName: 'move_file',
      summary: 'from=src/old.ts to=src/new.ts',
      at: '2026-07-28T00:00:00.000Z',
    } as RunEvent);

    rmSync(join(root, 'src/keep.ts'));
    writeFileSync(join(root, 'src/new.ts'), 'moved\n', 'utf8');
    unlinkSync(join(root, 'src/old.ts'));

    const view = buildRunFileChangesView({
      runId: 'r',
      workspaceRoot: root,
      snapshot,
    });
    expect(view!.files.map((f) => f.path).sort()).toEqual([
      'src/keep.ts',
      'src/new.ts',
      'src/old.ts',
    ]);

    const undone = undoRunFileChanges({ workspaceRoot: root, snapshot });
    expect(undone.failed).toEqual([]);
    expect(readFileSync(join(root, 'src/keep.ts'), 'utf8')).toBe('keep\n');
    expect(readFileSync(join(root, 'src/old.ts'), 'utf8')).toBe('moved\n');
    expect(() => readFileSync(join(root, 'src/new.ts'), 'utf8')).toThrow();
  });
});

describe('fileLinks', () => {
  it('detects workspace file refs', () => {
    expect(looksLikeWorkspaceFileRef('apps/vscode/src/foo.ts')).toBe(true);
    expect(looksLikeWorkspaceFileRef('foo.ts:12')).toBe(true);
    expect(looksLikeWorkspaceFileRef('https://example.com')).toBe(false);
    expect(looksLikeWorkspaceFileRef('#anchor')).toBe(false);
  });

  it('parses path:line:col refs', () => {
    expect(parseFileRef('apps/a.ts:10:2')).toEqual({
      path: 'apps/a.ts',
      line: 10,
      column: 2,
    });
    expect(inlineCodeAsFileRef('`protocol.ts`'.replace(/`/g, ''))).toEqual({
      path: 'protocol.ts',
    });
  });
});
