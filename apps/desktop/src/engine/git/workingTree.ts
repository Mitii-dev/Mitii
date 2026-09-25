/**
 * Agent Working Tree — Desktop git status + safe mutations.
 *
 * Read/write for the Source Control pane only. Does not widen V8 GitPort
 * (agent tools stay read-only; Decision Policy still owns run_command grants).
 */

import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';

import {
  flattenWorkingTreeFiles,
  parsePorcelainWorkingTree,
  type GitBranchListSnapshot,
  type GitMutationResult,
  type GitWorkingTreeSnapshot,
} from '../../shared/git/workingTree.js';
import {
  appendPathsAfterDoubleDash,
  assertSafeGitArg,
  DesktopGitArgError,
} from './argSafety.js';
import {
  getGitFileChangesSummary,
  getGitFileDiff,
} from './status.js';

const execFileAsync = promisify(execFile);

export { getGitFileDiff, getGitFileChangesSummary };

async function runGit(
  cwd: string,
  args: string[],
  options?: { timeoutMs?: number; maxBuffer?: number },
): Promise<{ stdout: string; stderr: string }> {
  try {
    const result = await execFileAsync('git', args, {
      cwd,
      timeout: options?.timeoutMs ?? 30_000,
      maxBuffer: options?.maxBuffer ?? 4 * 1024 * 1024,
      encoding: 'utf8',
    });
    return {
      stdout: String(result.stdout ?? ''),
      stderr: String(result.stderr ?? ''),
    };
  } catch (err: unknown) {
    if (err && typeof err === 'object') {
      const e = err as {
        stdout?: unknown;
        stderr?: unknown;
        message?: unknown;
        code?: unknown;
      };
      const stderr = String(e.stderr ?? '');
      const message =
        stderr.trim() ||
        (typeof e.message === 'string' ? e.message : 'git failed');
      throw new Error(message);
    }
    throw err instanceof Error ? err : new Error(String(err));
  }
}

/** Commit with message on stdin so multiline bodies stay out of argv. */
function runGitCommitWithMessage(
  cwd: string,
  message: string,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['commit', '-F', '-'], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error('git commit timed out'));
    }, 30_000);
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `git commit exited with ${code}`));
    });
    child.stdin?.end(`${message.trim()}\n`, 'utf8');
  });
}

export async function getGitWorkingTree(
  workspaceRoot: string,
  options?: { includeStatPreview?: boolean },
): Promise<GitWorkingTreeSnapshot> {
  try {
    // Match VS Code SCM: every untracked file (`-uall`), NUL-safe paths (`-z`).
    const status = await runGit(
      workspaceRoot,
      ['status', '--porcelain=v1', '-z', '-uall', '-b'],
      { timeoutMs: 45_000, maxBuffer: 16 * 1024 * 1024 },
    );
    const parsed = parsePorcelainWorkingTree(status.stdout);
    const files = flattenWorkingTreeFiles(parsed);
    let statPreview: string | undefined;
    // `git diff --stat` is expensive on large dirty trees and was blocking the
    // engine during AI bulk writes — only compute when explicitly requested.
    if (options?.includeStatPreview) {
      try {
        const diff = await runGit(workspaceRoot, ['diff', '--stat', 'HEAD'], {
          timeoutMs: 8_000,
        });
        statPreview = diff.stdout.trim().slice(0, 4000) || undefined;
      } catch {
        statPreview = undefined;
      }
    }
    return {
      ok: true,
      ...(parsed.branch ? { branch: parsed.branch } : {}),
      summary: parsed.summary,
      ...(parsed.ahead !== undefined ? { ahead: parsed.ahead } : {}),
      ...(parsed.behind !== undefined ? { behind: parsed.behind } : {}),
      staged: parsed.staged,
      changes: parsed.changes,
      untracked: parsed.untracked,
      files,
      changeCount: files.length,
      ...(statPreview ? { statPreview } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      summary: 'Not a git repository (or git unavailable).',
      staged: [],
      changes: [],
      untracked: [],
      files: [],
      changeCount: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/** Coalesce concurrent status reads so bulk FS events don't stampede git. */
const gitStatusInflight = new Map<string, Promise<GitWorkingTreeSnapshot>>();
const gitStatusCache = new Map<
  string,
  { at: number; value: GitWorkingTreeSnapshot }
>();
const GIT_STATUS_CACHE_MS = 400;

export async function getGitWorkingTreeCoalesced(
  workspaceRoot: string,
  options?: { includeStatPreview?: boolean; bypassCache?: boolean },
): Promise<GitWorkingTreeSnapshot> {
  const key = `${workspaceRoot}\0${options?.includeStatPreview ? '1' : '0'}`;
  if (!options?.bypassCache) {
    const cached = gitStatusCache.get(key);
    if (cached && Date.now() - cached.at < GIT_STATUS_CACHE_MS) {
      return cached.value;
    }
  }
  let inflight = gitStatusInflight.get(key);
  if (!inflight) {
    inflight = getGitWorkingTree(workspaceRoot, options).finally(() => {
      gitStatusInflight.delete(key);
    });
    gitStatusInflight.set(key, inflight);
  }
  const value = await inflight;
  gitStatusCache.set(key, { at: Date.now(), value });
  return value;
}

/** Drop cached status after mutations so the next read is fresh. */
export function invalidateGitWorkingTreeCache(workspaceRoot?: string): void {
  if (!workspaceRoot) {
    gitStatusCache.clear();
    return;
  }
  for (const key of gitStatusCache.keys()) {
    if (key === workspaceRoot || key.startsWith(`${workspaceRoot}\0`)) {
      gitStatusCache.delete(key);
    }
  }
}

/** Back-compat alias used by older engine imports. */
export async function getGitStatus(
  workspaceRoot: string,
): Promise<GitWorkingTreeSnapshot> {
  return getGitWorkingTreeCoalesced(workspaceRoot);
}

export async function listGitBranches(
  workspaceRoot: string,
): Promise<GitBranchListSnapshot> {
  try {
    const raw = await runGit(workspaceRoot, [
      'branch',
      '--format=%(refname:short)',
    ]);
    const branches = raw.stdout
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);
    for (const branch of branches) {
      assertSafeGitArg(branch, 'git branch');
    }
    let current: string | undefined;
    try {
      current = (
        await runGit(workspaceRoot, ['branch', '--show-current'])
      ).stdout.trim();
      if (!current) current = undefined;
    } catch {
      current = undefined;
    }
    return { ok: true, ...(current ? { current } : {}), branches };
  } catch (error) {
    return {
      ok: false,
      branches: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function withStatus(
  workspaceRoot: string,
  mutate: () => Promise<void>,
): Promise<GitMutationResult> {
  try {
    await mutate();
    invalidateGitWorkingTreeCache(workspaceRoot);
    return {
      ok: true,
      status: await getGitWorkingTreeCoalesced(workspaceRoot, {
        bypassCache: true,
      }),
    };
  } catch (error) {
    invalidateGitWorkingTreeCache(workspaceRoot);
    return {
      ok: false,
      error:
        error instanceof DesktopGitArgError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error),
      status: await getGitWorkingTreeCoalesced(workspaceRoot, {
        bypassCache: true,
      }),
    };
  }
}

function sanitizePaths(paths: readonly string[] | undefined): string[] {
  return [
    ...new Set(
      (paths ?? [])
        .map((p) => p.replace(/\\/g, '/').trim())
        .filter(Boolean),
    ),
  ].slice(0, 200);
}

/** Stage paths, or all changes when paths empty. */
export async function gitStage(
  workspaceRoot: string,
  paths?: readonly string[],
): Promise<GitMutationResult> {
  const list = sanitizePaths(paths);
  return withStatus(workspaceRoot, async () => {
    if (list.length === 0) {
      await runGit(workspaceRoot, ['add', '-A']);
      return;
    }
    await runGit(workspaceRoot, appendPathsAfterDoubleDash(['add'], list));
  });
}

/** Unstage paths, or all staged when paths empty. */
export async function gitUnstage(
  workspaceRoot: string,
  paths?: readonly string[],
): Promise<GitMutationResult> {
  const list = sanitizePaths(paths);
  return withStatus(workspaceRoot, async () => {
    if (list.length === 0) {
      await runGit(workspaceRoot, ['restore', '--staged', '.']);
      return;
    }
    await runGit(
      workspaceRoot,
      appendPathsAfterDoubleDash(['restore', '--staged'], list),
    );
  });
}

/**
 * Discard worktree changes for tracked paths.
 * Untracked paths require `includeUntracked` (uses `git clean -f -- path`).
 */
export async function gitDiscard(
  workspaceRoot: string,
  paths: readonly string[],
  options?: { includeUntracked?: boolean },
): Promise<GitMutationResult> {
  const list = sanitizePaths(paths);
  if (list.length === 0) {
    return { ok: false, error: 'paths_required' };
  }
  return withStatus(workspaceRoot, async () => {
    const status = await getGitWorkingTree(workspaceRoot);
    const untracked = new Set(status.untracked.map((f) => f.path));
    const tracked = list.filter((p) => !untracked.has(p));
    const junk = list.filter((p) => untracked.has(p));
    if (tracked.length > 0) {
      await runGit(
        workspaceRoot,
        appendPathsAfterDoubleDash(['restore', '--worktree'], tracked),
      );
    }
    if (junk.length > 0) {
      if (!options?.includeUntracked) {
        throw new Error(
          'Untracked paths require confirm (includeUntracked).',
        );
      }
      await runGit(
        workspaceRoot,
        appendPathsAfterDoubleDash(['clean', '-f'], junk),
      );
    }
  });
}

export async function gitCommit(
  workspaceRoot: string,
  message: string,
  options?: { all?: boolean },
): Promise<GitMutationResult> {
  const trimmed = message.trim();
  if (!trimmed) {
    return { ok: false, error: 'commit_message_required' };
  }
  if (trimmed.includes('\0')) {
    return { ok: false, error: 'commit_message_invalid' };
  }
  return withStatus(workspaceRoot, async () => {
    if (options?.all) {
      await runGit(workspaceRoot, ['add', '-A']);
    }
    await runGitCommitWithMessage(workspaceRoot, trimmed);
  });
}

export async function gitCheckout(
  workspaceRoot: string,
  branch: string,
  options?: { create?: boolean },
): Promise<GitMutationResult> {
  try {
    assertSafeGitArg(branch, 'git branch');
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return withStatus(workspaceRoot, async () => {
    if (options?.create) {
      await runGit(workspaceRoot, ['checkout', '-b', branch]);
    } else {
      await runGit(workspaceRoot, ['checkout', branch]);
    }
  });
}
