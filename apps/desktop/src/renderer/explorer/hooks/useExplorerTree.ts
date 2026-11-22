import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { fetchWorkspaceTree, streamWorkspaceEvents } from '../../api.js';
import {
  isTransientEngineNetworkError,
  withEngineFetchRetry,
} from '../../shell/engineNetwork.js';
import type { PathMove, TreeEntry } from '../explorerTypes.js';
import { flattenVisible } from '../flattenVisible.js';
import { fileName, parentOf, remapUnder } from '../pathUtils.js';

export interface UseExplorerTreeOptions {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  /** Bumped by the parent when the agent mutates paths. */
  workspaceInvalidate?: { seq: number; paths: string[] } | null;
  onError: (message: string | null) => void;
  /** Debounced batch of changed paths (after tree refresh is scheduled). */
  onPathsChanged: (paths: string[]) => void;
  /** Longer debounce than the tree — SCM refresh after bulk writes. */
  onGitStale: () => void;
}

export function useExplorerTree(options: UseExplorerTreeOptions) {
  const { baseUrl, token, workspaceRoot, onError } = options;
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<
    Record<string, TreeEntry[]>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [workspaceRootOpen, setWorkspaceRootOpen] = useState(true);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());

  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const onPathsChangedRef = useRef(options.onPathsChanged);
  onPathsChangedRef.current = options.onPathsChanged;
  const onGitStaleRef = useRef(options.onGitStale);
  onGitStaleRef.current = options.onGitStale;

  const loadDir = useCallback(
    async (path: string) => {
      setLoadingDirs((prev) => new Set(prev).add(path));
      try {
        const result = await withEngineFetchRetry(() =>
          fetchWorkspaceTree({ baseUrl, token, path }),
        );
        if (!path) setRootEntries(result.entries);
        else {
          setChildrenByPath((prev) => ({
            ...prev,
            [path]: result.entries,
          }));
        }
      } catch (err) {
        // Keep prior tree during bulk AI writes / engine blips.
        if (isTransientEngineNetworkError(err)) return;
        onErrorRef.current(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [baseUrl, token],
  );

  useEffect(() => {
    setExpanded(new Set());
    setChildrenByPath({});
    setWorkspaceRootOpen(true);
    void loadDir('');
  }, [workspaceRoot, loadDir]);

  const toggleDir = async (path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!childrenByPath[path]) {
      await loadDir(path);
    }
  };

  const expandPath = useCallback((path: string) => {
    setExpanded((prev) => new Set(prev).add(path));
  }, []);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
    setWorkspaceRootOpen(true);
  }, []);

  /** Expand every ancestor folder so a file is visible in the tree. */
  const revealPaths = (parents: string[]) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      for (const p of parents) next.add(p);
      return next;
    });
    for (const p of parents) {
      if (!childrenByPath[p]) void loadDir(p);
    }
  };

  const reloadAll = async () => {
    await loadDir('');
    for (const dir of [...expanded]) {
      await loadDir(dir);
    }
  };

  const refreshParents = useCallback(
    async (paths: string[]) => {
      const dirs = new Set<string>(['']);
      for (const path of paths) {
        if (!path || path === '.') continue;
        let cur = parentOf(path);
        for (;;) {
          dirs.add(cur);
          if (!cur) break;
          const next = parentOf(cur);
          if (next === cur) break;
          cur = next;
        }
      }
      for (const dir of expanded) {
        if (
          paths.some(
            (p) => p === dir || (Boolean(p) && p.startsWith(`${dir}/`)),
          )
        ) {
          dirs.add(dir);
        }
      }
      const ordered = [...dirs].sort(
        (a, b) =>
          a.split('/').filter(Boolean).length -
          b.split('/').filter(Boolean).length,
      );
      // Batch directory reloads so large FS bursts stay responsive.
      const concurrency = 6;
      for (let i = 0; i < ordered.length; i += concurrency) {
        const chunk = ordered.slice(i, i + concurrency);
        await Promise.all(chunk.map((dir) => loadDir(dir)));
      }
    },
    [loadDir, expanded],
  );

  /** Remap expanded dirs + cached children after rename/move. */
  const remapPaths = useCallback((moved: PathMove[]) => {
    const remap = (path: string) => {
      let cur = path;
      for (const { from, to } of moved) cur = remapUnder(from, to, cur);
      return cur;
    };
    setExpanded((prev) => {
      const next = new Set<string>();
      for (const p of prev) next.add(remap(p));
      return next;
    });
    setChildrenByPath((prev) => {
      const next: Record<string, TreeEntry[]> = {};
      for (const [key, value] of Object.entries(prev)) {
        next[remap(key)] = value.map((entry) => {
          const path = remap(entry.path);
          return { ...entry, path, name: fileName(path) };
        });
      }
      return next;
    });
  }, []);

  const treeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPathsRef = useRef<Set<string>>(new Set());
  const refreshParentsRef = useRef(refreshParents);
  refreshParentsRef.current = refreshParents;

  const applyWorkspacePaths = useCallback((paths: string[]) => {
    for (const path of paths) pendingPathsRef.current.add(path);
    if (treeTimerRef.current) clearTimeout(treeTimerRef.current);
    treeTimerRef.current = setTimeout(() => {
      const batch = [...pendingPathsRef.current];
      pendingPathsRef.current.clear();
      void refreshParentsRef.current(batch);
      onPathsChangedRef.current(batch);
    }, 200);
    // Longer debounce than the FS watcher — bulk AI writes must not stampede git.
    if (gitTimerRef.current) clearTimeout(gitTimerRef.current);
    gitTimerRef.current = setTimeout(() => {
      onGitStaleRef.current();
    }, 600);
  }, []);

  // Live FS watch from the engine (external edits + agent writes on disk).
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      try {
        for await (const msg of streamWorkspaceEvents({
          baseUrl,
          token,
          signal: controller.signal,
        })) {
          if (cancelled) break;
          if (msg.type === 'change' && msg.paths.length > 0) {
            applyWorkspacePaths(msg.paths);
          }
        }
      } catch {
        /* aborted or engine down — agent invalidate still works */
      }
    })();
    return () => {
      cancelled = true;
      controller.abort();
      if (treeTimerRef.current) clearTimeout(treeTimerRef.current);
      if (gitTimerRef.current) clearTimeout(gitTimerRef.current);
    };
  }, [baseUrl, token, workspaceRoot, applyWorkspacePaths]);

  // Immediate invalidate from agent write tools (faster than waiting on FS watch).
  const invalidate = options.workspaceInvalidate;
  useEffect(() => {
    if (!invalidate || invalidate.seq <= 0) return;
    applyWorkspacePaths(invalidate.paths.length > 0 ? invalidate.paths : ['.']);
  }, [invalidate, applyWorkspacePaths]);

  // Entry rows never depend on the create draft (it only injects `create` rows).
  const visibleEntries = useMemo(
    () =>
      flattenVisible(rootEntries, childrenByPath, expanded, null).flatMap(
        (row) => (row.type === 'entry' ? [row.entry] : []),
      ),
    [rootEntries, childrenByPath, expanded],
  );

  const entryByPath = useMemo(() => {
    const map = new Map<string, TreeEntry>();
    for (const entry of visibleEntries) map.set(entry.path, entry);
    return map;
  }, [visibleEntries]);

  return {
    rootEntries,
    childrenByPath,
    expanded,
    workspaceRootOpen,
    setWorkspaceRootOpen,
    loadingDirs,
    loadDir,
    toggleDir,
    expandPath,
    collapseAll,
    revealPaths,
    reloadAll,
    refreshParents,
    remapPaths,
    visibleEntries,
    entryByPath,
  };
}

export type ExplorerTreeModel = ReturnType<typeof useExplorerTree>;
