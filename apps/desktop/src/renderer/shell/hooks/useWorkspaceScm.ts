import { useCallback, useEffect, useRef, useState } from 'react';

import { fetchGitStatus } from '../../api.js';
import type { GitWorkingTreeSnapshot } from '../../../shared/git/workingTree.js';
import {
  isTransientEngineNetworkError,
  withEngineFetchRetry,
} from '../engineNetwork.js';

export interface UseWorkspaceScmOptions {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  /** Active activity side; the SCM pane owns status fetches while 'git'. */
  side: string;
  onGitCountChange?: (count: number) => void;
  onError: (message: string | null) => void;
}

/** Git status snapshot + refresh token shared by the explorer host and SCM pane. */
export function useWorkspaceScm(options: UseWorkspaceScmOptions) {
  const { baseUrl, token, workspaceRoot, side, onError } = options;
  const [git, setGit] = useState<GitWorkingTreeSnapshot | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const tokenRef = useRef(0);
  const sideRef = useRef(side);
  sideRef.current = side;
  const onCountRef = useRef(options.onGitCountChange);
  onCountRef.current = options.onGitCountChange;

  const loadGit = useCallback(async () => {
    try {
      const next = await withEngineFetchRetry(() =>
        fetchGitStatus({ baseUrl, token }),
      );
      setGit(next);
      onCountRef.current?.(next.changeCount ?? next.files.length);
    } catch (err) {
      // Engine blips during bulk AI writes — don't poison the UI.
      if (isTransientEngineNetworkError(err)) return;
      onError(err instanceof Error ? err.message : String(err));
    }
  }, [baseUrl, token, onError]);

  const bumpRefreshToken = useCallback(() => {
    tokenRef.current += 1;
    setRefreshToken(tokenRef.current);
  }, []);

  /** Reload status here and nudge the SCM pane. */
  const refresh = useCallback(() => {
    void loadGit();
    bumpRefreshToken();
  }, [loadGit, bumpRefreshToken]);

  /** FS-watch settled: SCM pane owns the fetch when visible, else reload here. */
  const onWatchSettled = useCallback(() => {
    if (sideRef.current === 'git') bumpRefreshToken();
    else void loadGit();
  }, [bumpRefreshToken, loadGit]);

  useEffect(() => {
    void loadGit();
  }, [workspaceRoot, loadGit]);

  useEffect(() => {
    if (side === 'git') void loadGit();
  }, [side, loadGit]);

  return { git, setGit, loadGit, refreshToken, refresh, onWatchSettled };
}

export type WorkspaceScmModel = ReturnType<typeof useWorkspaceScm>;
