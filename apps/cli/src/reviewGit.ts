import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import {
  parseGitPorcelain,
  porcelainToReviewEntries,
  type GitPorcelainReviewEntry,
  type ReviewChangedFile,
} from '@mitii/sdk';

const execFileAsync = promisify(execFile);

const GIT_MAX_BUFFER = 32 * 1024 * 1024;
/** Well-known hash of git's empty tree; used as the base when HEAD does not exist yet. */
const EMPTY_TREE = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';

export type ReviewGitMode = 'workspace' | 'range' | 'commit' | 'scan';

export interface ListGitChangedFilesParams {
  cwd: string;
  mode: ReviewGitMode;
  fromRef?: string;
  toRef?: string;
  commit?: string;
  paths?: string[];
}

/** Raised when git cannot produce the change list; the command maps it to a non-zero exit. */
export class ReviewGitError extends Error {
  readonly code = 'review_git_failed';
  constructor(
    message: string,
    readonly gitArgs: readonly string[],
  ) {
    super(message);
    this.name = 'ReviewGitError';
  }
}

interface ChangedEntry {
  path: string;
  status: ReviewChangedFile['status'];
  untracked?: boolean;
}

function statusFromLetter(letter: string): ReviewChangedFile['status'] {
  switch (letter) {
    case 'D':
      return 'deleted';
    case 'A':
      return 'added';
    case 'R':
      return 'renamed';
    case 'C':
      return 'copied';
    default:
      return 'modified';
  }
}

/** Parse `git status --porcelain -z` via shared V8 porcelain helpers. */
export function parsePorcelainZ(text: string): ChangedEntry[] {
  return porcelainToReviewEntries(parseGitPorcelain(text)).map(
    (entry: GitPorcelainReviewEntry): ChangedEntry => ({
      path: entry.path,
      status: entry.status === 'unknown' ? 'modified' : entry.status,
      ...(entry.untracked ? { untracked: true } : {}),
    }),
  );
}

/** Parse `git diff|show --name-status -z` output. */
export function parseNameStatusZ(text: string): ChangedEntry[] {
  const tokens = text.split('\0').map((token) => token.replace(/^\n+/, ''));
  const out: ChangedEntry[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const code = tokens[i]!;
    if (!code) continue;
    const letter = code[0]!;
    if (letter === 'R' || letter === 'C') {
      const to = tokens[i + 2];
      i += 2;
      if (to) out.push({ path: to, status: statusFromLetter(letter) });
      continue;
    }
    const path = tokens[i + 1];
    i += 1;
    if (path) out.push({ path, status: statusFromLetter(letter) });
  }
  return out;
}

async function runGit(
  cwd: string,
  args: string[],
  options: { okExitCodes?: number[] } = {},
): Promise<string> {
  try {
    const { stdout } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: GIT_MAX_BUFFER,
    });
    return stdout;
  } catch (error) {
    const failure = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number | string;
    };
    if (
      typeof failure.code === 'number' &&
      options.okExitCodes?.includes(failure.code)
    ) {
      return failure.stdout ?? '';
    }
    const detail =
      failure.stderr?.trim() ||
      (failure.code === 'ENOENT' ? 'git executable not found' : failure.message);
    throw new ReviewGitError(
      `git ${args[0] ?? ''} failed: ${detail}`,
      args,
    );
  }
}

async function resolveWorkspaceBase(cwd: string): Promise<string> {
  try {
    await execFileAsync('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], {
      cwd,
    });
    return 'HEAD';
  } catch {
    // No commits yet (or not a repo — the status call reports that first).
    return EMPTY_TREE;
  }
}

function countLines(diff: string): { insertions: number; deletions: number } {
  return {
    insertions: (diff.match(/^\+(?!\+\+)/gm) ?? []).length,
    deletions: (diff.match(/^-(?!--)/gm) ?? []).length,
  };
}

function detectBinary(diff: string): boolean {
  return /^Binary files .* differ$/m.test(diff) || /^GIT binary patch/m.test(diff);
}

/**
 * List changed files with per-file diffs. Throws {@link ReviewGitError} when git
 * fails; an empty list only ever means "nothing changed".
 */
export async function listGitChangedFiles(
  params: ListGitChangedFilesParams,
): Promise<ReviewChangedFile[]> {
  if (params.mode === 'scan') {
    // Scan mode expects hosts to pass paths; empty means nothing to review.
    return (params.paths ?? []).map((path) => ({
      path,
      diff: '',
      content: undefined,
      insertions: 0,
      deletions: 0,
      isBinary: false,
      isDeleted: false,
      status: 'unknown' as const,
    }));
  }

  const isCommit = params.mode === 'commit' && Boolean(params.commit);
  const isRange =
    params.mode === 'range' && Boolean(params.fromRef && params.toRef);
  const rangeSpec = isRange ? `${params.fromRef}...${params.toRef}` : undefined;

  let entries: ChangedEntry[];
  let base = 'HEAD';
  if (isCommit) {
    const out = await runGit(params.cwd, [
      'show',
      '--name-status',
      '-z',
      '--format=',
      params.commit!,
    ]);
    entries = parseNameStatusZ(out);
  } else if (isRange) {
    const out = await runGit(params.cwd, [
      'diff',
      '--name-status',
      '-z',
      rangeSpec!,
    ]);
    entries = parseNameStatusZ(out);
  } else {
    const out = await runGit(params.cwd, [
      'status',
      '--porcelain',
      '-z',
      '-uall',
    ]);
    entries = parsePorcelainZ(out);
    base = await resolveWorkspaceBase(params.cwd);
  }

  const wanted = params.paths?.length ? new Set(params.paths) : undefined;
  const filtered = wanted
    ? entries.filter((entry) => wanted.has(entry.path))
    : entries;

  const files: ReviewChangedFile[] = [];
  for (const entry of filtered) {
    let diff: string;
    if (isCommit) {
      diff = await runGit(params.cwd, [
        'show',
        '--format=',
        params.commit!,
        '--',
        entry.path,
      ]);
    } else if (isRange) {
      diff = await runGit(params.cwd, ['diff', rangeSpec!, '--', entry.path]);
    } else if (entry.untracked) {
      // Untracked files have no HEAD entry; diff against /dev/null (exit 1 = differences).
      diff = await runGit(
        params.cwd,
        ['diff', '--no-index', '--', '/dev/null', entry.path],
        { okExitCodes: [1] },
      );
    } else {
      diff = await runGit(params.cwd, ['diff', base, '--', entry.path]);
    }
    const isBinary = detectBinary(diff);
    const { insertions, deletions } = isBinary
      ? { insertions: 0, deletions: 0 }
      : countLines(diff);
    files.push({
      path: entry.path,
      diff,
      insertions,
      deletions,
      isBinary,
      isDeleted: entry.status === 'deleted',
      status: entry.status,
    });
  }
  return files;
}
