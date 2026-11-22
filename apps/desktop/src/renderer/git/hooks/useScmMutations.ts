import { useState } from 'react';

import type { GitWorkingTreeSnapshot } from '../../../shared/git/workingTree.js';
import {
  gitCommitChanges,
  gitDiscardFiles,
  gitStageFiles,
  gitStashFiles,
  gitUnstageFiles,
} from '../../api.js';
import type { ScmAuth } from '../scmTypes.js';

type MutationResult = {
  ok: boolean;
  error?: string;
  status?: GitWorkingTreeSnapshot;
};

export interface UseScmMutationsOptions {
  auth: ScmAuth;
  applyStatus: (next: GitWorkingTreeSnapshot) => void;
  loadGit: () => Promise<void>;
  onError?: (error: string | null) => void;
  onStatusNote?: (note: string | null) => void;
  onPathsDiscarded?: (paths: readonly string[]) => void;
}

export function useScmMutations(opts: UseScmMutationsOptions) {
  const { auth, applyStatus, loadGit, onError, onStatusNote, onPathsDiscarded } =
    opts;
  const [busy, setBusy] = useState(false);

  const runMutation = async (
    action: () => Promise<MutationResult>,
    okNote?: string,
    options?: { discardedPaths?: readonly string[] },
  ) => {
    setBusy(true);
    onError?.(null);
    try {
      const result = await action();
      if (result.status) applyStatus(result.status);
      else await loadGit();
      if (!result.ok) {
        onError?.(result.error ?? 'git_failed');
        return;
      }
      if (options?.discardedPaths && options.discardedPaths.length > 0) {
        onPathsDiscarded?.(options.discardedPaths);
      }
      if (okNote) onStatusNote?.(okNote);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const stagePaths = (paths: string[]) =>
    runMutation(() => gitStageFiles({ ...auth, paths }));

  const unstagePaths = (paths?: string[]) =>
    runMutation(() =>
      gitUnstageFiles(paths ? { ...auth, paths } : { ...auth }),
    );

  const discardPaths = (paths: string[], untrackedPathSet: ReadonlySet<string>) => {
    const hasJunk = paths.some((p) => untrackedPathSet.has(p));
    const label = paths.length === 1 ? paths[0] : `${paths.length} files`;
    const verb = hasJunk ? 'Discard / delete' : 'Discard changes to';
    if (!window.confirm(`${verb} ${label}?`)) return;
    void runMutation(
      () => gitDiscardFiles({ ...auth, paths, includeUntracked: hasJunk }),
      undefined,
      { discardedPaths: paths },
    );
  };

  const stashPaths = (paths: string[], includeUntracked: boolean) =>
    runMutation(
      () => gitStashFiles({ ...auth, paths, includeUntracked }),
      `Stashed ${paths.length} path${paths.length === 1 ? '' : 's'}`,
    );

  const commit = (message: string) =>
    runMutation(() => gitCommitChanges({ ...auth, message }), 'Committed');

  return {
    busy,
    runMutation,
    stagePaths,
    unstagePaths,
    discardPaths,
    stashPaths,
    commit,
  };
}
