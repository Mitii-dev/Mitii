import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';

import {
  fetchGitDiff,
  fetchWorkspaceFile,
  saveWorkspaceFile,
} from '../../api.js';
import type { OpenTab, PathMove, WorkspaceSide } from '../explorerTypes.js';
import { fileName, isMarkdownPath, remapUnder } from '../pathUtils.js';

export interface UseEditorTabsOptions {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  onError: (message: string | null) => void;
  onNote: (note: string | null) => void;
  /** Switch the activity side when a tab opens (file → explorer, diff → git). */
  onSideChange: (side: WorkspaceSide) => void;
  /** Expand ancestors in the tree after a file opens. */
  revealPaths: (parents: string[]) => void;
  /** Called after a successful save (git refresh). */
  onSaved: () => void;
  onFileSaved?: (path: string) => void;
  onEditorContextChange?: (ctx: {
    activePath: string | null;
    openPaths: string[];
  }) => void;
  openPathRequest?: { path: string; view?: 'file' | 'diff' } | null;
  onOpenPathHandled?: () => void;
}

function diffPathMatches(tabPath: string, doomed: string[]): boolean {
  const filePath = tabPath.replace(/^diff:/, '');
  return doomed.some((p) => filePath === p || filePath.startsWith(`${p}/`));
}

export function useEditorTabs(options: UseEditorTabsOptions) {
  const { baseUrl, token, workspaceRoot, onError, onNote, onSideChange } =
    options;
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [mdPreview, setMdPreview] = useState(false);
  const autoSaveTimerRef = useRef<number | null>(null);
  const tabsRef = useRef(tabs);
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const active = tabs.find((t) => t.path === activePath) ?? null;
  const activeIsMarkdown =
    Boolean(active) && active!.mode === 'file' && isMarkdownPath(active!.path);
  const showMdPreview = activeIsMarkdown && mdPreview;

  useEffect(() => {
    if (!activeIsMarkdown) setMdPreview(false);
  }, [activeIsMarkdown, activePath]);

  useEffect(() => {
    setTabs([]);
    setActivePath(null);
  }, [workspaceRoot]);

  const { onEditorContextChange } = options;
  useEffect(() => {
    if (!onEditorContextChange) return;
    const openPaths = tabs
      .filter((t) => t.mode === 'file' && !t.path.startsWith('diff:'))
      .map((t) => t.path);
    const current =
      activePath && !activePath.startsWith('diff:') ? activePath : null;
    onEditorContextChange({ activePath: current, openPaths });
  }, [activePath, tabs, onEditorContextChange]);

  const fail = (err: unknown) =>
    onError(err instanceof Error ? err.message : String(err));

  const openFile = async (
    path: string,
    opts?: { preview?: boolean; pin?: boolean },
  ) => {
    onError(null);
    onNote(null);
    const asPreview = opts?.pin ? false : opts?.preview !== false;
    const existing = tabs.find((t) => t.path === path && t.mode === 'file');
    if (existing && !existing.loading) {
      setActivePath(path);
      onSideChange('explorer');
      if (!asPreview && existing.preview) {
        setTabs((prev) =>
          prev.map((t) =>
            t.path === path && t.mode === 'file'
              ? { ...t, preview: false }
              : t,
          ),
        );
      }
      return;
    }
    // Optimistic tab so clicks feel instant while the engine may be busy indexing.
    setTabs((prev) => {
      let next = prev.filter((t) => t.path !== path);
      if (asPreview) {
        next = next.filter((t) => !(t.preview && t.mode === 'file'));
      }
      return [
        ...next,
        {
          path,
          content: '',
          savedContent: '',
          truncated: false,
          mode: 'file' as const,
          loading: true,
          preview: asPreview,
        },
      ];
    });
    setActivePath(path);
    onSideChange('explorer');
    onNote('Opening…');
    try {
      const file = await fetchWorkspaceFile({ baseUrl, token, path });
      setTabs((prev) => {
        let without = prev.filter(
          (t) => t.path !== path && t.path !== file.path,
        );
        if (asPreview) {
          without = without.filter((t) => !(t.preview && t.mode === 'file'));
        }
        return [
          ...without,
          {
            path: file.path,
            content: file.content,
            savedContent: file.content,
            truncated: file.truncated,
            mode: 'file' as const,
            loading: false,
            preview: asPreview,
          },
        ];
      });
      setActivePath(file.path);
      onNote(null);
      // Expand parents so the file is visible in the tree.
      const parts = file.path.split('/');
      const parents: string[] = [];
      for (let i = 0; i < parts.length - 1; i += 1) {
        parents.push(parts.slice(0, i + 1).join('/'));
      }
      options.revealPaths(parents);
    } catch (err) {
      setTabs((prev) => prev.filter((t) => t.path !== path));
      setActivePath((cur) => (cur === path ? null : cur));
      onNote(null);
      fail(err);
    }
  };

  const pinTab = useCallback((path: string) => {
    setTabs((prev) =>
      prev.map((t) =>
        t.path === path && t.mode === 'file' ? { ...t, preview: false } : t,
      ),
    );
  }, []);

  const openDiff = async (path: string) => {
    onError(null);
    onNote(null);
    const tabPath = `diff:${path}`;
    try {
      const result = await fetchGitDiff({ baseUrl, token, path });
      const content =
        result.diff ||
        '(no diff available — file missing, empty, or binary)';
      setTabs((prev) => {
        const without = prev.filter((t) => t.path !== tabPath);
        return [
          ...without,
          {
            path: tabPath,
            content,
            savedContent: content,
            truncated: false,
            mode: 'diff',
          },
        ];
      });
      setActivePath(tabPath);
      onSideChange('git');
    } catch (err) {
      fail(err);
    }
  };

  const req = options.openPathRequest;
  useEffect(() => {
    const path = req?.path?.trim();
    if (!path) return;
    const open =
      req?.view === 'diff' ? openDiff(path) : openFile(path, { pin: true });
    void open.finally(() => options.onOpenPathHandled?.());
    // intentionally only react to openPathRequest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [req]);

  const closeTab = (path: string) => {
    const tab = tabs.find((t) => t.path === path);
    if (tab && tab.content !== tab.savedContent) {
      const ok = window.confirm(`Discard unsaved changes to ${fileName(path)}?`);
      if (!ok) return;
    }
    setTabs((prev) => {
      const next = prev.filter((t) => t.path !== path);
      if (activePath === path) {
        setActivePath(next[next.length - 1]?.path ?? null);
      }
      return next;
    });
  };

  const saveActive = async (targetPath?: string) => {
    const tab =
      (targetPath
        ? tabsRef.current.find((t) => t.path === targetPath)
        : null) ??
      tabsRef.current.find((t) => t.path === activePath) ??
      null;
    if (!tab || tab.mode !== 'file') return;
    if (tab.content === tab.savedContent) return;
    if (tab.truncated) {
      onError('File was truncated on open — cannot save safely.');
      return;
    }
    if (tab.loading) return;
    onError(null);
    try {
      await saveWorkspaceFile({
        baseUrl,
        token,
        path: tab.path,
        content: tab.content,
      });
      setTabs((prev) =>
        prev.map((t) =>
          t.path === tab.path ? { ...t, savedContent: t.content } : t,
        ),
      );
      options.onSaved();
      options.onFileSaved?.(tab.path);
    } catch (err) {
      fail(err);
    }
  };

  // Debounced autosave for dirty file tabs (⌘Z/⌘⇧Z still use native textarea undo).
  useEffect(() => {
    if (autoSaveTimerRef.current != null) {
      window.clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    const dirtyTabs = tabs.filter(
      (t) =>
        t.mode === 'file' &&
        !t.loading &&
        !t.truncated &&
        t.content !== t.savedContent,
    );
    if (dirtyTabs.length === 0) return;
    autoSaveTimerRef.current = window.setTimeout(() => {
      autoSaveTimerRef.current = null;
      for (const t of dirtyTabs) {
        void saveActive(t.path);
      }
    }, 800);
    return () => {
      if (autoSaveTimerRef.current != null) {
        window.clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tabs]);

  const updateActiveContent = (content: string) => {
    if (!active) return;
    setTabs((prev) =>
      prev.map((t) =>
        t.path === active.path ? { ...t, content, preview: false } : t,
      ),
    );
  };

  const onEditorKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 's') {
      e.preventDefault();
      void saveActive();
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const el = e.currentTarget;
      const start = el.selectionStart;
      const end = el.selectionEnd;
      updateActiveContent(
        active!.content.slice(0, start) + '  ' + active!.content.slice(end),
      );
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  const reloadCleanOpenFiles = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return;
      const affected = (tabPath: string) =>
        paths.some(
          (p) =>
            !p ||
            p === '.' ||
            tabPath === p ||
            tabPath.startsWith(`${p}/`),
        );
      const targets = tabsRef.current.filter(
        (t) =>
          t.mode === 'file' &&
          !t.loading &&
          t.content === t.savedContent &&
          affected(t.path),
      );
      for (const tab of targets) {
        try {
          const file = await fetchWorkspaceFile({
            baseUrl,
            token,
            path: tab.path,
          });
          setTabs((prev) =>
            prev.map((t) =>
              t.path === tab.path && t.mode === 'file'
                ? {
                    ...t,
                    content: file.content,
                    savedContent: file.content,
                    truncated: file.truncated,
                  }
                : t,
            ),
          );
        } catch {
          /* file may have been deleted — tree refresh handles removal */
        }
      }
    },
    [baseUrl, token],
  );

  const closeTabsMatching = useCallback((paths: string[]) => {
    setTabs((prev) => {
      const next = prev.filter((t) =>
        t.mode === 'diff'
          ? !diffPathMatches(t.path, paths)
          : !paths.some((p) => t.path === p || t.path.startsWith(`${p}/`)),
      );
      setActivePath((cur) => {
        if (!cur) return cur;
        const stillOpen = next.some((t) => t.path === cur);
        return stillOpen ? cur : (next[next.length - 1]?.path ?? null);
      });
      return next;
    });
  }, []);

  /** Remap open tab paths after rename/move. */
  const remapPaths = useCallback((moved: PathMove[]) => {
    const remap = (path: string) => {
      let cur = path;
      for (const { from, to } of moved) cur = remapUnder(from, to, cur);
      return cur;
    };
    setTabs((prev) =>
      prev.map((t) => {
        if (t.mode === 'diff') {
          const filePath = t.path.replace(/^diff:/, '');
          const nextFile = remap(filePath);
          return nextFile === filePath ? t : { ...t, path: `diff:${nextFile}` };
        }
        const path = remap(t.path);
        return path === t.path ? t : { ...t, path };
      }),
    );
    setActivePath((cur) => {
      if (!cur) return cur;
      if (cur.startsWith('diff:')) {
        return `diff:${remap(cur.replace(/^diff:/, ''))}`;
      }
      return remap(cur);
    });
  }, []);

  /** After SCM discard: drop stale diff tabs and reload / close file tabs. */
  const handlePathsDiscarded = async (paths: string[]) => {
    const list = [...paths];
    // Diff tabs are always stale after discard.
    setTabs((prev) => {
      const next = prev.filter(
        (t) => t.mode !== 'diff' || !diffPathMatches(t.path, list),
      );
      setActivePath((cur) => {
        if (!cur) return cur;
        return next.some((t) => t.path === cur)
          ? cur
          : (next[next.length - 1]?.path ?? null);
      });
      return next;
    });
    // Tracked restore: reload open file tabs. Untracked delete:
    // drop the tab if the file is gone so later opens stay clean.
    for (const path of list) {
      const open = tabsRef.current.find(
        (t) => t.path === path && t.mode === 'file',
      );
      if (!open) continue;
      try {
        const file = await fetchWorkspaceFile({ baseUrl, token, path });
        setTabs((prev) =>
          prev.map((t) =>
            t.path === path && t.mode === 'file'
              ? {
                  ...t,
                  content: file.content,
                  savedContent: file.content,
                  truncated: file.truncated,
                  loading: false,
                }
              : t,
          ),
        );
      } catch {
        closeTabsMatching([path]);
      }
    }
  };

  return {
    tabs,
    activePath,
    setActivePath,
    active,
    mdPreview,
    setMdPreview,
    activeIsMarkdown,
    showMdPreview,
    openFile,
    openDiff,
    pinTab,
    closeTab,
    saveActive,
    updateActiveContent,
    onEditorKeyDown,
    reloadCleanOpenFiles,
    closeTabsMatching,
    remapPaths,
    handlePathsDiscarded,
  };
}

export type EditorTabsModel = ReturnType<typeof useEditorTabs>;
