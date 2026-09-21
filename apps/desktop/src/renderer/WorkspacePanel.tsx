import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import {
  deleteWorkspacePaths,
  fetchAbsoluteWorkspacePath,
  fetchGitDiff,
  fetchGitStatus,
  fetchWorkspaceFile,
  fetchWorkspaceTree,
  renameWorkspacePath,
  saveWorkspaceFile,
  shortPath,
  streamPrompt,
} from './api.js';
import { CodeEditor } from './CodeEditor.js';
import { CodeExtensionsPane } from './CodeExtensionsPane.js';
import { DiffView, gitStatusKind } from './DiffView.js';
import { ResizeHandle, usePersistedWidth } from './ResizeHandle.js';
import {
  CODE_REVIEW_PROMPT,
  ingestReviewFinding,
  type ReviewFinding,
} from '../shared/reviewFindings.js';

interface WorkspacePanelProps {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  /** Compact header when embedded in Code mode. */
  embedded?: boolean;
  /** Hide the internal Files/Git rail (parent activity bar owns those icons). */
  hideActivityRail?: boolean;
  /** Controlled explorer/git/extensions pane (used with hideActivityRail). */
  side?: 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes';
  onSideChange?: (side: 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes') => void;
  onGitCountChange?: (count: number) => void;
  /** Open this path when set (e.g. from chat file-changes card). */
  openPathRequest?: { path: string; view?: 'file' | 'diff' } | null;
  onOpenPathHandled?: () => void;
  /** Insert a recipe prompt into the chat composer. */
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onRestartEngine?: () => Promise<void>;
}

type TreeEntry = { name: string; path: string; kind: 'file' | 'dir' };
type GitFile = { path: string; status: string };

interface OpenTab {
  path: string;
  content: string;
  savedContent: string;
  truncated: boolean;
  mode: 'file' | 'diff';
}

type ContextMenuState = {
  x: number;
  y: number;
  paths: string[];
};

function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

function flattenVisible(
  entries: TreeEntry[],
  childrenByPath: Record<string, TreeEntry[]>,
  expanded: Set<string>,
): TreeEntry[] {
  const out: TreeEntry[] = [];
  const walk = (list: TreeEntry[]) => {
    for (const entry of list) {
      out.push(entry);
      if (
        entry.kind === 'dir' &&
        expanded.has(entry.path) &&
        childrenByPath[entry.path]
      ) {
        walk(childrenByPath[entry.path]);
      }
    }
  };
  walk(entries);
  return out;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const [internalSide, setInternalSide] = useState<
    'explorer' | 'git' | 'mcp' | 'skills' | 'recipes'
  >('explorer');
  const side = props.side ?? internalSide;
  const setSide = (
    next: 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes',
  ) => {
    if (props.onSideChange) props.onSideChange(next);
    else setInternalSide(next);
  };
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<
    Record<string, TreeEntry[]>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);
  const [git, setGit] = useState<{
    ok: boolean;
    summary: string;
    branch?: string;
    files: GitFile[];
    statPreview?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sideWidth, setSideWidth] = usePersistedWidth('mitii.desktop.explorerWidth', {
    initial: 260,
    min: 160,
    max: 520,
  });
  const [reviewFindings, setReviewFindings] = useState<ReviewFinding[]>([]);
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewStatus, setReviewStatus] = useState<string | null>(null);
  const [reviewError, setReviewError] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  const auth = { baseUrl: props.baseUrl, token: props.token };
  const active = tabs.find((t) => t.path === activePath) ?? null;
  const dirty = Boolean(active && active.content !== active.savedContent);

  const loadDir = useCallback(
    async (path: string) => {
      setLoadingDirs((prev) => new Set(prev).add(path));
      try {
        const result = await fetchWorkspaceTree({ ...auth, path });
        if (!path) setRootEntries(result.entries);
        else {
          setChildrenByPath((prev) => ({
            ...prev,
            [path]: result.entries,
          }));
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoadingDirs((prev) => {
          const next = new Set(prev);
          next.delete(path);
          return next;
        });
      }
    },
    [props.baseUrl, props.token],
  );

  const loadGit = useCallback(async () => {
    try {
      const next = await fetchGitStatus(auth);
      setGit(next);
      props.onGitCountChange?.(next.files.length);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, [props.baseUrl, props.token, props.onGitCountChange]);

  useEffect(() => {
    setTabs([]);
    setActivePath(null);
    setExpanded(new Set());
    setChildrenByPath({});
    setReviewFindings([]);
    setReviewStatus(null);
    setReviewError(null);
    void loadDir('');
    void loadGit();
  }, [props.workspaceRoot, loadDir, loadGit]);

  useEffect(() => {
    if (side === 'git') void loadGit();
  }, [side, loadGit]);

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

  const openFile = async (path: string) => {
    setError(null);
    setNote(null);
    const existing = tabs.find((t) => t.path === path && t.mode === 'file');
    if (existing) {
      setActivePath(path);
      setSide('explorer');
      return;
    }
    try {
      const file = await fetchWorkspaceFile({ ...auth, path });
      setTabs((prev) => {
        const without = prev.filter((t) => t.path !== path);
        return [
          ...without,
          {
            path: file.path,
            content: file.content,
            savedContent: file.content,
            truncated: file.truncated,
            mode: 'file',
          },
        ];
      });
      setActivePath(file.path);
      setSide('explorer');
      // Expand parents so the file is visible in the tree.
      const parts = file.path.split('/');
      const parents: string[] = [];
      for (let i = 0; i < parts.length - 1; i += 1) {
        parents.push(parts.slice(0, i + 1).join('/'));
      }
      setExpanded((prev) => {
        const next = new Set(prev);
        for (const p of parents) next.add(p);
        return next;
      });
      for (const p of parents) {
        if (!childrenByPath[p]) void loadDir(p);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    const req = props.openPathRequest;
    const path = req?.path?.trim();
    if (!path) return;
    const open =
      req?.view === 'diff' ? openDiff(path) : openFile(path);
    void open.finally(() => props.onOpenPathHandled?.());
    // intentionally only react to openPathRequest
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.openPathRequest]);

  const runCodeReview = async () => {
    setReviewBusy(true);
    setReviewError(null);
    setReviewFindings([]);
    setReviewStatus('Reviewing git changes…');
    setSide('git');
    const findings: ReviewFinding[] = [];
    try {
      for await (const line of streamPrompt({
        baseUrl: props.baseUrl,
        token: props.token,
        prompt: CODE_REVIEW_PROMPT,
        mode: 'agent',
        approvalPreset: 'guided',
        thoroughness: 'medium',
        pinnedPaths: (git?.files ?? []).map((f) => f.path).slice(0, 24),
      })) {
        if (line.op === 'error') {
          throw new Error(line.message ?? line.error);
        }
        if (line.op === 'event') {
          const finding = ingestReviewFinding(line.event);
          if (finding) {
            findings.push(finding);
            setReviewFindings([...findings]);
            setReviewStatus(
              `${findings.length} finding${findings.length === 1 ? '' : 's'}…`,
            );
          }
        }
      }
      setReviewStatus(
        findings.length === 0
          ? 'Review finished — no findings emitted'
          : `${findings.length} finding${findings.length === 1 ? '' : 's'}`,
      );
      void loadGit();
    } catch (err) {
      setReviewError(err instanceof Error ? err.message : String(err));
      setReviewStatus(null);
    } finally {
      setReviewBusy(false);
    }
  };

  const openDiff = async (path: string) => {
    setError(null);
    setNote(null);
    const tabPath = `diff:${path}`;
    try {
      const result = await fetchGitDiff({ ...auth, path });
      const content =
        result.diff || '(no textual diff — binary or untracked)';
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
      setSide('git');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

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

  const saveActive = async () => {
    if (!active || active.mode !== 'file' || !dirty) return;
    if (active.truncated) {
      setError('File was truncated on open — cannot save safely.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await saveWorkspaceFile({
        ...auth,
        path: active.path,
        content: active.content,
      });
      setTabs((prev) =>
        prev.map((t) =>
          t.path === active.path
            ? { ...t, savedContent: t.content }
            : t,
        ),
      );
      setNote('Saved');
      window.setTimeout(() => setNote(null), 1200);
      void loadGit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
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
      const next =
        active!.content.slice(0, start) + '  ' + active!.content.slice(end);
      setTabs((prev) =>
        prev.map((t) =>
          t.path === active!.path ? { ...t, content: next } : t,
        ),
      );
      requestAnimationFrame(() => {
        el.selectionStart = el.selectionEnd = start + 2;
      });
    }
  };

  const visibleEntries = useMemo(
    () => flattenVisible(rootEntries, childrenByPath, expanded),
    [rootEntries, childrenByPath, expanded],
  );

  const entryByPath = useMemo(() => {
    const map = new Map<string, TreeEntry>();
    for (const entry of visibleEntries) map.set(entry.path, entry);
    return map;
  }, [visibleEntries]);

  const refreshParents = useCallback(
    async (paths: string[]) => {
      const parents = new Set(paths.map(parentOf));
      for (const parent of parents) {
        await loadDir(parent);
      }
    },
    [loadDir],
  );

  const closeTabsMatching = useCallback((paths: string[]) => {
    const doomed = new Set(paths);
    setTabs((prev) => {
      const next = prev.filter((t) => {
        if (t.mode === 'diff') {
          const filePath = t.path.replace(/^diff:/, '');
          return ![...doomed].some(
            (p) => filePath === p || filePath.startsWith(`${p}/`),
          );
        }
        return ![...doomed].some(
          (p) => t.path === p || t.path.startsWith(`${p}/`),
        );
      });
      setActivePath((cur) => {
        if (!cur) return cur;
        const stillOpen = next.some((t) => t.path === cur);
        return stillOpen ? cur : (next[next.length - 1]?.path ?? null);
      });
      return next;
    });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (ev: globalThis.KeyboardEvent) => {
      if (ev.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!renamingPath) return;
    renameInputRef.current?.focus();
    renameInputRef.current?.select();
  }, [renamingPath]);

  const selectRange = (anchor: string, target: string) => {
    const paths = visibleEntries.map((e) => e.path);
    const a = paths.indexOf(anchor);
    const b = paths.indexOf(target);
    if (a < 0 || b < 0) {
      setSelectedPaths(new Set([target]));
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelectedPaths(new Set(paths.slice(lo, hi + 1)));
  };

  const onExplorerClick = (
    entry: TreeEntry,
    e: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    const multi = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;

    if (range && selectionAnchor) {
      e.preventDefault();
      selectRange(selectionAnchor, entry.path);
      return;
    }

    if (multi) {
      e.preventDefault();
      setSelectedPaths((prev) => {
        const next = new Set(prev);
        if (next.has(entry.path)) next.delete(entry.path);
        else next.add(entry.path);
        return next;
      });
      setSelectionAnchor(entry.path);
      return;
    }

    setSelectedPaths(new Set([entry.path]));
    setSelectionAnchor(entry.path);
    if (entry.kind === 'dir') void toggleDir(entry.path);
    else void openFile(entry.path);
  };

  const onExplorerContextMenu = (
    entry: TreeEntry,
    e: ReactMouseEvent<HTMLButtonElement>,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    let paths = [...selectedPaths];
    if (!selectedPaths.has(entry.path)) {
      paths = [entry.path];
      setSelectedPaths(new Set([entry.path]));
      setSelectionAnchor(entry.path);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, paths });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied');
      window.setTimeout(() => setNote(null), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const copyRelativePaths = async (paths: string[]) => {
    await copyText(paths.join('\n'));
  };

  const copyAbsolutePaths = async (paths: string[]) => {
    const abs = await Promise.all(
      paths.map((path) => fetchAbsoluteWorkspacePath({ ...auth, path })),
    );
    await copyText(abs.join('\n'));
  };

  const copyNames = async (paths: string[]) => {
    await copyText(paths.map(fileName).join('\n'));
  };

  const beginRename = (path: string) => {
    setContextMenu(null);
    setRenamingPath(path);
    setRenameValue(fileName(path));
  };

  const commitRename = async () => {
    if (!renamingPath) return;
    const nextName = renameValue.trim();
    if (!nextName || nextName === fileName(renamingPath)) {
      setRenamingPath(null);
      return;
    }
    try {
      const result = await renameWorkspacePath({
        ...auth,
        path: renamingPath,
        newName: nextName,
      });
      const oldPath = renamingPath;
      setRenamingPath(null);
      setSelectedPaths(new Set([result.path]));
      setSelectionAnchor(result.path);
      setExpanded((prev) => {
        if (!prev.has(oldPath) && ![...prev].some((p) => p.startsWith(`${oldPath}/`))) {
          return prev;
        }
        const next = new Set<string>();
        for (const p of prev) {
          if (p === oldPath) next.add(result.path);
          else if (p.startsWith(`${oldPath}/`)) {
            next.add(`${result.path}${p.slice(oldPath.length)}`);
          } else next.add(p);
        }
        return next;
      });
      setChildrenByPath((prev) => {
        const next: Record<string, TreeEntry[]> = {};
        for (const [key, value] of Object.entries(prev)) {
          let nextKey = key;
          if (key === oldPath) nextKey = result.path;
          else if (key.startsWith(`${oldPath}/`)) {
            nextKey = `${result.path}${key.slice(oldPath.length)}`;
          }
          next[nextKey] = value.map((entry) => {
            if (entry.path === oldPath || entry.path.startsWith(`${oldPath}/`)) {
              return {
                ...entry,
                path:
                  entry.path === oldPath
                    ? result.path
                    : `${result.path}${entry.path.slice(oldPath.length)}`,
                name:
                  entry.path === oldPath ? fileName(result.path) : entry.name,
              };
            }
            return entry;
          });
        }
        return next;
      });
      setTabs((prev) =>
        prev.map((t) => {
          if (t.mode === 'file' && t.path === oldPath) {
            return { ...t, path: result.path };
          }
          if (t.mode === 'diff' && t.path === `diff:${oldPath}`) {
            return { ...t, path: `diff:${result.path}` };
          }
          if (t.mode === 'file' && t.path.startsWith(`${oldPath}/`)) {
            return {
              ...t,
              path: `${result.path}${t.path.slice(oldPath.length)}`,
            };
          }
          return t;
        }),
      );
      setActivePath((cur) => {
        if (!cur) return cur;
        if (cur === oldPath) return result.path;
        if (cur === `diff:${oldPath}`) return `diff:${result.path}`;
        if (cur.startsWith(`${oldPath}/`)) {
          return `${result.path}${cur.slice(oldPath.length)}`;
        }
        return cur;
      });
      await refreshParents([oldPath, result.path]);
      void loadGit();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRenamingPath(null);
    }
  };

  const deleteSelected = async (paths: string[]) => {
    setContextMenu(null);
    if (paths.length === 0) return;
    const label =
      paths.length === 1 ? fileName(paths[0]) : `${paths.length} items`;
    const ok = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteWorkspacePaths({ ...auth, paths });
      closeTabsMatching(paths);
      setSelectedPaths(new Set());
      setSelectionAnchor(null);
      await refreshParents(paths);
      void loadGit();
      setNote('Deleted');
      window.setTimeout(() => setNote(null), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderTree = (entries: TreeEntry[], depth: number) =>
    entries.map((entry) => {
      const isOpen = expanded.has(entry.path);
      const kids = childrenByPath[entry.path];
      const isSelected = selectedPaths.has(entry.path);
      const isActive =
        active?.mode === 'file' && active.path === entry.path;
      const isRenaming = renamingPath === entry.path;
      return (
        <div key={entry.path} className="explorer-node">
          {isRenaming ? (
            <div
              className="explorer-row explorer-row--rename"
              style={{ paddingLeft: 8 + depth * 12 }}
            >
              <span className="explorer-twist" aria-hidden />
              <span
                className={`explorer-icon explorer-icon--${entry.kind}`}
                aria-hidden
              />
              <input
                ref={renameInputRef}
                className="explorer-rename"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={() => void commitRename()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void commitRename();
                  }
                  if (e.key === 'Escape') {
                    e.preventDefault();
                    setRenamingPath(null);
                  }
                }}
              />
            </div>
          ) : (
            <button
              type="button"
              className={`explorer-row${isSelected || isActive ? ' is-active' : ''}${isSelected ? ' is-selected' : ''}`}
              style={{ paddingLeft: 8 + depth * 12 }}
              onClick={(e) => onExplorerClick(entry, e)}
              onContextMenu={(e) => onExplorerContextMenu(entry, e)}
              title={entry.path}
            >
              <span className="explorer-twist" aria-hidden>
                {entry.kind === 'dir'
                  ? loadingDirs.has(entry.path)
                    ? '…'
                    : isOpen
                      ? '▾'
                      : '▸'
                  : ''}
              </span>
              <span
                className={`explorer-icon explorer-icon--${entry.kind}`}
                aria-hidden
              />
              <span className="explorer-label">{entry.name}</span>
            </button>
          )}
          {entry.kind === 'dir' && isOpen && kids
            ? renderTree(kids, depth + 1)
            : null}
        </div>
      );
    });

  const menuPaths = contextMenu?.paths ?? [];
  const menuSingle = menuPaths.length === 1 ? menuPaths[0] : null;
  const menuEntry = menuSingle ? entryByPath.get(menuSingle) : undefined;

  const crumbs = active
    ? (active.mode === 'diff'
        ? active.path.replace(/^diff:/, '')
        : active.path
      ).split('/')
    : [];

  const workspaceLabel = shortPath(props.workspaceRoot);

  return (
    <div className={`workspace-view${props.embedded ? ' workspace-view--embedded' : ''}`}>
      <div
        className="workspace-body"
        style={
          {
            gridTemplateColumns: `${sideWidth}px 5px minmax(0, 1fr)`,
          } as CSSProperties
        }
      >
        <aside
          className={`workspace-side${props.hideActivityRail ? ' workspace-side--flush' : ''}`}
        >
          {props.hideActivityRail ? null : (
            <div className="activity-rail" aria-label="Workspace views">
              <button
                type="button"
                className={side === 'explorer' ? 'is-active' : undefined}
                title="Explorer"
                aria-label="Explorer"
                onClick={() => setSide('explorer')}
              >
                <span aria-hidden>⧉</span>
              </button>
              <button
                type="button"
                className={side === 'git' ? 'is-active' : undefined}
                title="Source Control"
                aria-label="Source Control"
                onClick={() => {
                  setSide('git');
                  void loadGit();
                }}
              >
                <span aria-hidden>⎇</span>
                {git?.files.length ? (
                  <em className="activity-badge">{git.files.length}</em>
                ) : null}
              </button>
            </div>
          )}

          <div className="workspace-pane">
            {side === 'explorer' ? (
              <>
                <div className="workspace-pane__title">
                  <span>Explorer</span>
                  <button
                    type="button"
                    className="icon-quiet"
                    title="Refresh"
                    onClick={() => {
                      setChildrenByPath({});
                      void loadDir('');
                    }}
                  >
                    ↻
                  </button>
                </div>
                <div className="workspace-pane__root" title={props.workspaceRoot}>
                  {workspaceLabel}
                </div>
                <div
                  className="explorer-tree"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.target instanceof HTMLInputElement) return;
                    if (
                      (e.key === 'Delete' || e.key === 'Backspace') &&
                      selectedPaths.size > 0
                    ) {
                      e.preventDefault();
                      void deleteSelected([...selectedPaths]);
                    }
                    if (e.key === 'F2' && selectedPaths.size === 1) {
                      e.preventDefault();
                      beginRename([...selectedPaths][0]);
                    }
                  }}
                >
                  {rootEntries.length === 0 ? (
                    <p className="workspace-empty">No files</p>
                  ) : (
                    renderTree(rootEntries, 0)
                  )}
                </div>
              </>
            ) : side === 'git' ? (
              <div className="git-pane">
                <div className="git-pane__changes">
                  <div className="workspace-pane__title">
                    <span>Source Control</span>
                    <div className="workspace-pane__actions">
                      <button
                        type="button"
                        className="btn-ghost git-review-btn"
                        disabled={reviewBusy || !(git?.files.length)}
                        title="LLM code review of git changes"
                        onClick={() => void runCodeReview()}
                      >
                        {reviewBusy ? 'Reviewing…' : 'Code Review'}
                      </button>
                      <button
                        type="button"
                        className="icon-quiet"
                        title="Refresh"
                        onClick={() => void loadGit()}
                      >
                        ↻
                      </button>
                    </div>
                  </div>
                  <div className="workspace-git-summary">
                    <strong>{git?.branch ?? 'Git'}</strong>
                    <span>{git?.summary ?? 'Loading…'}</span>
                  </div>
                  <div className="explorer-tree">
                    {(git?.files ?? []).map((file) => (
                      <button
                        key={file.path}
                        type="button"
                        className={`explorer-row explorer-row--git explorer-row--git-${gitStatusKind(file.status)}${
                          activePath === `diff:${file.path}` ? ' is-active' : ''
                        }`}
                        style={{ paddingLeft: 10 }}
                        onClick={() => void openDiff(file.path)}
                        onDoubleClick={() => void openFile(file.path)}
                        title="Click: diff · Double-click: open file"
                      >
                        <span
                          className={`workspace-git-status workspace-git-status--${gitStatusKind(file.status)}`}
                        >
                          {file.status}
                        </span>
                        <span className="explorer-label">{file.path}</span>
                      </button>
                    ))}
                    {git && git.files.length === 0 ? (
                      <p className="workspace-empty">
                        {git.ok ? 'Working tree clean' : git.summary}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="git-pane__review">
                  <div className="workspace-pane__title">
                    <span>Code Review</span>
                    {reviewStatus ? (
                      <span className="git-review-status">{reviewStatus}</span>
                    ) : null}
                  </div>
                  {reviewError ? (
                    <p className="workspace-empty git-review-error">
                      {reviewError}
                    </p>
                  ) : null}
                  <div className="git-review-list">
                    {reviewFindings.length === 0 && !reviewBusy ? (
                      <p className="workspace-empty">
                        Run Code Review to analyze git changes. Findings appear
                        here.
                      </p>
                    ) : null}
                    {reviewFindings.map((finding, i) => (
                      <button
                        key={`${finding.path}:${finding.startLine ?? 0}:${i}`}
                        type="button"
                        className={`git-review-finding git-review-finding--${finding.severity}`}
                        onClick={() => {
                          void openDiff(finding.path);
                        }}
                        title={finding.path}
                      >
                        <span className="git-review-finding__sev">
                          {finding.severity}
                        </span>
                        <span className="git-review-finding__path">
                          {finding.path}
                          {finding.startLine ? `:${finding.startLine}` : ''}
                        </span>
                        <span className="git-review-finding__msg">
                          {finding.content}
                        </span>
                        {finding.existingCode ? (
                          <pre className="git-review-finding__code">
                            {finding.existingCode.slice(0, 400)}
                          </pre>
                        ) : null}
                        {finding.suggestionCode ? (
                          <pre className="git-review-finding__code git-review-finding__code--suggest">
                            {finding.suggestionCode.slice(0, 400)}
                          </pre>
                        ) : null}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <CodeExtensionsPane
                baseUrl={props.baseUrl}
                token={props.token}
                side={side}
                onUsePrompt={props.onUsePrompt}
                onRestartEngine={props.onRestartEngine}
              />
            )}
          </div>
        </aside>

        <ResizeHandle
          value={sideWidth}
          onChange={setSideWidth}
          min={160}
          max={520}
          label="Resize explorer"
        />

        <section className="editor-shell">
          {tabs.length > 0 ? (
            <div className="editor-tabs" role="tablist">
              {tabs.map((tab) => (
                <div
                  key={tab.path}
                  className={`editor-tab${
                    tab.path === activePath ? ' is-active' : ''
                  }${tab.content !== tab.savedContent ? ' is-dirty' : ''}`}
                  role="tab"
                  aria-selected={tab.path === activePath}
                >
                  <button
                    type="button"
                    className="editor-tab__label"
                    onClick={() => setActivePath(tab.path)}
                    title={tab.path}
                  >
                    {tab.mode === 'diff'
                      ? `${fileName(tab.path.replace(/^diff:/, ''))} (diff)`
                      : fileName(tab.path)}
                  </button>
                  <button
                    type="button"
                    className="editor-tab__close"
                    aria-label={`Close ${tab.path}`}
                    onClick={() => closeTab(tab.path)}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          ) : null}

          {error ? <div className="alert">{error}</div> : null}

          {active ? (
            <>
              <div className="editor-breadcrumb">
                <div className="editor-breadcrumb__path">
                  {crumbs.map((part, i) => (
                    <span key={`${part}-${i}`}>
                      {i > 0 ? (
                        <span className="editor-breadcrumb__sep">/</span>
                      ) : null}
                      <span
                        className={
                          i === crumbs.length - 1
                            ? 'editor-breadcrumb__current'
                            : undefined
                        }
                      >
                        {part}
                      </span>
                    </span>
                  ))}
                </div>
                <div className="editor-breadcrumb__actions">
                  {note ? <span className="editor-note">{note}</span> : null}
                  {active.truncated ? (
                    <span className="editor-note">truncated · read-only</span>
                  ) : null}
                  {active.mode === 'diff' ? (
                    <button
                      type="button"
                      className="btn-ghost"
                      onClick={() =>
                        void openFile(active.path.replace(/^diff:/, ''))
                      }
                    >
                      Open file
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn-primary"
                      disabled={!dirty || saving || active.truncated}
                      onClick={() => void saveActive()}
                    >
                      {saving ? 'Saving…' : dirty ? 'Save' : 'Saved'}
                    </button>
                  )}
                </div>
              </div>

              {active.mode === 'diff' ? (
                <DiffView content={active.content} />
              ) : (
                <CodeEditor
                  path={active.path}
                  value={active.content}
                  readOnly={active.truncated}
                  onChange={(content) => {
                    setTabs((prev) =>
                      prev.map((t) =>
                        t.path === active.path ? { ...t, content } : t,
                      ),
                    );
                  }}
                  onKeyDown={onEditorKeyDown}
                />
              )}
            </>
          ) : (
            <div className="workspace-hero">
              <h2>EXPLORER</h2>
              <p>
                Open a file from the tree. Edit in place —{' '}
                <kbd>⌘S</kbd> / <kbd>Ctrl+S</kbd> to save.
              </p>
              {git?.statPreview ? (
                <pre className="workspace-stat">{git.statPreview}</pre>
              ) : null}
            </div>
          )}
        </section>
      </div>

      {contextMenu ? (
        <div
          className="explorer-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {menuSingle && menuEntry?.kind === 'file' ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setContextMenu(null);
                void openFile(menuSingle);
              }}
            >
              Open
            </button>
          ) : null}
          {menuSingle ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => beginRename(menuSingle)}
            >
              Rename
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            className="explorer-menu__danger"
            onClick={() => void deleteSelected(menuPaths)}
          >
            Delete
          </button>
          <hr />
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              void copyAbsolutePaths(menuPaths);
            }}
          >
            Copy Path
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              void copyRelativePaths(menuPaths);
            }}
          >
            Copy Relative Path
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setContextMenu(null);
              void copyNames(menuPaths);
            }}
          >
            Copy Name
          </button>
        </div>
      ) : null}
    </div>
  );
}
