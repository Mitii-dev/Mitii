import { useCallback, useEffect, useMemo, useState } from 'react';

import type {
  GitWorkingTreeFile,
  GitWorkingTreeSnapshot,
} from '../../../shared/git/workingTree.js';
import { fetchGitStatus } from '../../api.js';
import {
  isTransientEngineNetworkError,
  withEngineFetchRetry,
} from '../../shell/engineNetwork.js';

export interface UseGitWorkingTreeStatusOptions {
  baseUrl: string;
  token?: string;
  refreshToken?: number;
  onGitCountChange?: (count: number) => void;
  onStatusSnapshot?: (status: GitWorkingTreeSnapshot) => void;
  onError?: (error: string | null) => void;
  /** Called with the paths still present so selection can be pruned. */
  onValidPaths?: (valid: ReadonlySet<string>) => void;
}

export function useGitWorkingTreeStatus(opts: UseGitWorkingTreeStatusOptions) {
  const {
    baseUrl,
    token,
    refreshToken,
    onGitCountChange,
    onStatusSnapshot,
    onError,
    onValidPaths,
  } = opts;
  const [git, setGit] = useState<GitWorkingTreeSnapshot | null>(null);

  const changeFiles = useMemo(() => {
    const dirty = git?.changes ?? [];
    const untracked = git?.untracked ?? [];
    return [...dirty, ...untracked].sort((a, b) =>
      a.path.localeCompare(b.path),
    );
  }, [git?.changes, git?.untracked]);

  const untrackedPathSet = useMemo(
    () => new Set((git?.untracked ?? []).map((f) => f.path)),
    [git?.untracked],
  );

  const fileByPath = useMemo(() => {
    const map = new Map<string, GitWorkingTreeFile>();
    for (const f of git?.files ?? []) map.set(f.path, f);
    return map;
  }, [git?.files]);

  const applyStatus = useCallback(
    (next: GitWorkingTreeSnapshot) => {
      setGit(next);
      onValidPaths?.(new Set(next.files.map((f) => f.path)));
      onGitCountChange?.(next.changeCount ?? next.files.length);
      onStatusSnapshot?.(next);
    },
    [onGitCountChange, onStatusSnapshot, onValidPaths],
  );

  const loadGit = useCallback(async () => {
    try {
      const next = await withEngineFetchRetry(() =>
        fetchGitStatus({ baseUrl, token }),
      );
      applyStatus(next);
    } catch (err) {
      if (isTransientEngineNetworkError(err)) return;
      onError?.(err instanceof Error ? err.message : String(err));
    }
  }, [baseUrl, token, applyStatus, onError]);

  useEffect(() => {
    void loadGit();
  }, [loadGit]);

  useEffect(() => {
    if (!refreshToken) return;
    void loadGit();
  }, [refreshToken, loadGit]);

  return { git, changeFiles, untrackedPathSet, fileByPath, applyStatus, loadGit };
}
