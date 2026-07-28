import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import type { RunEvent } from '@mitii/sdk';

import type { FileChangeEntryView, RunFileChangesView } from './protocol.js';

const execFileAsync = promisify(execFile);
const WRITE_TOOLS = new Set(['apply_patch']);

/** Snapshot taken at the start of a mutating run. */
export interface FileChangeRunSnapshot {
  /** Relative paths that were already dirty before the run. */
  preDirtyPaths: Set<string>;
  /** File contents at run start for paths we may need to restore. */
  beforeContents: Map<string, string | null>;
  /** Paths mutated by this run (from tool events / approvals). */
  mutatedPaths: Set<string>;
}

export interface UndoFileChangeResult {
  restored: string[];
  failed: Array<{ path: string; error: string }>;
}

/** List dirty workspace-relative paths from `git status --porcelain`. */
export async function listDirtyGitPaths(
  workspaceRoot: string,
): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['status', '--porcelain'],
      { cwd: workspaceRoot, timeout: 10_000 },
    );
    const paths: string[] = [];
    for (const line of stdout.split('\n')) {
      if (!line || line.startsWith('##')) continue;
      // rename: "R  old -> new" or "RM old -> new"
      const renamed = line.slice(3).split(' -> ');
      const path = (renamed[renamed.length - 1] ?? '').trim();
      if (path) paths.push(path.replace(/\\/g, '/'));
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Parse `paths=a,b,+N` fragments from tool summaries.
 */
export function parsePathsFromToolSummary(summary: string | undefined): string[] {
  if (!summary) return [];
  const match = /\bpaths=([^\s]+)/i.exec(summary);
  if (!match?.[1] || match[1] === 'none') return [];
  return match[1]
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && !part.startsWith('+'));
}

/**
 * Collect workspace-relative paths from a run event that indicates a write.
 */
export function collectMutatedPathsFromEvent(event: RunEvent): string[] {
  if (event.type === 'tool_started' || event.type === 'tool_completed') {
    if (!WRITE_TOOLS.has(event.toolName)) return [];
    if (event.type === 'tool_completed' && event.status !== 'succeeded') {
      return [];
    }
    return parsePathsFromToolSummary(event.summary);
  }
  return [];
}

/** Count line-level additions / deletions between two text blobs. */
export function countLineDiff(
  before: string | null,
  after: string | null,
): { additions: number; deletions: number } {
  const beforeLines = before === null ? [] : before.split('\n');
  const afterLines = after === null ? [] : after.split('\n');
  if (
    before !== null &&
    before.endsWith('\n') &&
    beforeLines[beforeLines.length - 1] === ''
  ) {
    beforeLines.pop();
  }
  if (
    after !== null &&
    after.endsWith('\n') &&
    afterLines[afterLines.length - 1] === ''
  ) {
    afterLines.pop();
  }
  if (before === null && after === null) {
    return { additions: 0, deletions: 0 };
  }
  if (before === null) {
    return { additions: afterLines.length, deletions: 0 };
  }
  if (after === null) {
    return { additions: 0, deletions: beforeLines.length };
  }

  const n = beforeLines.length;
  const m = afterLines.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () =>
    Array.from({ length: m + 1 }, () => 0),
  );
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      dp[i]![j] =
        beforeLines[i] === afterLines[j]
          ? (dp[i + 1]![j + 1] ?? 0) + 1
          : Math.max(dp[i + 1]![j] ?? 0, dp[i]![j + 1] ?? 0);
    }
  }
  let i = 0;
  let j = 0;
  let additions = 0;
  let deletions = 0;
  while (i < n && j < m) {
    if (beforeLines[i] === afterLines[j]) {
      i += 1;
      j += 1;
    } else if ((dp[i + 1]![j] ?? 0) >= (dp[i]![j + 1] ?? 0)) {
      deletions += 1;
      i += 1;
    } else {
      additions += 1;
      j += 1;
    }
  }
  deletions += n - i;
  additions += m - j;
  return { additions, deletions };
}

/** Build a short unified-diff style preview (truncated). */
export function buildPatchPreview(
  path: string,
  before: string | null,
  after: string | null,
  maxChars = 4000,
): string {
  const beforeLines = before === null ? [] : before.split('\n');
  const afterLines = after === null ? [] : after.split('\n');
  if (before !== null && before.endsWith('\n') && beforeLines.at(-1) === '') {
    beforeLines.pop();
  }
  if (after !== null && after.endsWith('\n') && afterLines.at(-1) === '') {
    afterLines.pop();
  }

  const lines: string[] = [`--- a/${path}`, `+++ b/${path}`];
  const max = Math.max(beforeLines.length, afterLines.length);
  for (let i = 0; i < max; i += 1) {
    const left = beforeLines[i];
    const right = afterLines[i];
    if (left === right) {
      if (left !== undefined) lines.push(` ${left}`);
      continue;
    }
    if (left !== undefined) lines.push(`-${left}`);
    if (right !== undefined) lines.push(`+${right}`);
  }
  const text = lines.join('\n');
  return text.length > maxChars ? `${text.slice(0, maxChars)}\n…` : text;
}

export function createFileChangeRunSnapshot(
  preDirtyPaths: Iterable<string> = [],
): FileChangeRunSnapshot {
  return {
    preDirtyPaths: new Set(
      [...preDirtyPaths].map((p) => p.replace(/\\/g, '/')),
    ),
    beforeContents: new Map(),
    mutatedPaths: new Set(),
  };
}

/** Remember current on-disk content before a path is mutated (best-effort). */
export function snapshotPathBeforeMutation(
  snapshot: FileChangeRunSnapshot,
  workspaceRoot: string,
  relPath: string,
): void {
  const normalized = relPath.replace(/\\/g, '/');
  if (snapshot.beforeContents.has(normalized)) return;
  const abs = join(workspaceRoot, normalized);
  try {
    if (!existsSync(abs)) {
      snapshot.beforeContents.set(normalized, null);
      return;
    }
    snapshot.beforeContents.set(normalized, readFileSync(abs, 'utf8'));
  } catch {
    snapshot.beforeContents.set(normalized, null);
  }
}

export function noteMutatedPaths(
  snapshot: FileChangeRunSnapshot,
  workspaceRoot: string,
  paths: readonly string[],
): void {
  for (const raw of paths) {
    const path = raw.replace(/\\/g, '/').trim();
    if (!path) continue;
    snapshotPathBeforeMutation(snapshot, workspaceRoot, path);
    snapshot.mutatedPaths.add(path);
  }
}

export function noteMutatedPathsFromEvent(
  snapshot: FileChangeRunSnapshot,
  workspaceRoot: string,
  event: RunEvent,
): void {
  if (event.type === 'tool_started' && WRITE_TOOLS.has(event.toolName)) {
    noteMutatedPaths(
      snapshot,
      workspaceRoot,
      parsePathsFromToolSummary(event.summary),
    );
    return;
  }
  noteMutatedPaths(
    snapshot,
    workspaceRoot,
    collectMutatedPathsFromEvent(event),
  );
}

function inferStatus(
  before: string | null,
  after: string | null,
): FileChangeEntryView['status'] {
  if (before === null && after !== null) return 'A';
  if (before !== null && after === null) return 'D';
  return 'M';
}

/**
 * Build the view model for files this run mutated (excludes pre-dirty-only paths
 * that the agent never touched).
 */
export function buildRunFileChangesView(options: {
  runId: string;
  workspaceRoot: string;
  snapshot: FileChangeRunSnapshot;
  maxPatchChars?: number;
}): RunFileChangesView | null {
  const { runId, workspaceRoot, snapshot } = options;
  const maxPatchChars = options.maxPatchChars ?? 4000;
  const files: FileChangeEntryView[] = [];
  let totalAdditions = 0;
  let totalDeletions = 0;

  const paths = [...snapshot.mutatedPaths].sort((a, b) => a.localeCompare(b));
  for (const path of paths) {
    const abs = join(workspaceRoot, path);
    let after: string | null = null;
    try {
      after = existsSync(abs) ? readFileSync(abs, 'utf8') : null;
    } catch {
      after = null;
    }
    const before = snapshot.beforeContents.has(path)
      ? (snapshot.beforeContents.get(path) ?? null)
      : null;
    if (before === after) continue;

    const { additions, deletions } = countLineDiff(before, after);
    totalAdditions += additions;
    totalDeletions += deletions;
    files.push({
      path,
      additions,
      deletions,
      status: inferStatus(before, after),
      patchPreview: buildPatchPreview(path, before, after, maxPatchChars),
      wasPreDirty: snapshot.preDirtyPaths.has(path),
    });
  }

  if (files.length === 0) return null;

  return {
    runId,
    files,
    totalAdditions,
    totalDeletions,
    leftUntouchedPreDirty: [...snapshot.preDirtyPaths].filter(
      (p) => !snapshot.mutatedPaths.has(p),
    ).length,
  };
}

/**
 * Restore files to the before-contents captured in the snapshot.
 */
export function undoRunFileChanges(options: {
  workspaceRoot: string;
  snapshot: FileChangeRunSnapshot;
  paths?: readonly string[];
}): UndoFileChangeResult {
  const { workspaceRoot, snapshot } = options;
  const targets = options.paths?.length
    ? options.paths.map((p) => p.replace(/\\/g, '/'))
    : [...snapshot.mutatedPaths];
  const restored: string[] = [];
  const failed: Array<{ path: string; error: string }> = [];

  for (const path of targets) {
    if (!snapshot.beforeContents.has(path)) {
      failed.push({ path, error: 'No before-snapshot for path' });
      continue;
    }
    const before = snapshot.beforeContents.get(path) ?? null;
    const abs = join(workspaceRoot, path);
    try {
      if (before === null) {
        if (existsSync(abs)) unlinkSync(abs);
      } else {
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, before, 'utf8');
      }
      restored.push(path);
    } catch (error) {
      failed.push({
        path,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { restored, failed };
}
