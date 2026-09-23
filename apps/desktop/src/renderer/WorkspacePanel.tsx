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
  copyWorkspacePaths,
  createWorkspaceFilePath,
  createWorkspaceFolderPath,
  deleteWorkspacePaths,
  fetchAbsoluteWorkspacePath,
  fetchGitDiff,
  fetchGitStatus,
  fetchWorkspaceFile,
  fetchWorkspaceTree,
  getDesktopBridge,
  moveWorkspacePaths,
  renameWorkspacePath,
  saveWorkspaceFile,
} from './api.js';
import { CodeEditor } from './CodeEditor.js';
import { GitWorkingTreePane } from './GitWorkingTreePane.js';
import { AutomationsPanel } from './AutomationsPanel.js';
import { McpManager } from './McpManager.js';
import { RecipesManager } from './RecipesManager.js';
import { SkillsManager } from './SkillsManager.js';
import { DiffView } from './DiffView.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconCollapseAll,
  IconEllipsis,
  IconFile,
  IconFiles,
  IconFolder,
  IconFolderOpen,
  IconGit,
  IconNewFile,
  IconNewFolder,
  IconRefresh,
} from './ActivityIcons.js';
import { ResizeHandle, usePersistedWidth } from './ResizeHandle.js';
import type { GitWorkingTreeSnapshot } from '../shared/gitWorkingTree.js';

interface WorkspacePanelProps {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  /** Compact header when embedded in Code mode. */
  embedded?: boolean;
  /** Hide the internal Files/Git rail (parent activity bar owns those icons). */
  hideActivityRail?: boolean;
  /** Controlled explorer/git/extensions pane (used with hideActivityRail). */
  side?: 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes' | 'automations';
  onSideChange?: (
    side: 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes' | 'automations',
  ) => void;
  /** Automations panel (activity bar). */
  automations?: {
    specs: import('./AutomationsPanel.js').AutomationSpecView[];
    runs: import('./AutomationsPanel.js').AutomationRunView[];
    loading?: boolean;
    error?: string | null;
    onRefresh: () => void;
    onTrigger: (specId: string) => void;
    onPause: (specId: string) => void;
    onResume: (specId: string) => void;
  };
  /** Notify parent of open editor paths for context auto-pin. */
  onEditorContextChange?: (ctx: {
    activePath: string | null;
    openPaths: string[];
  }) => void;
  /** Fired after a successful workspace file save (for index debounce). */
  onFileSaved?: (path: string) => void;
  onGitCountChange?: (count: number) => void;
  /** Open this path when set (e.g. from chat file-changes card). */
  openPathRequest?: { path: string; view?: 'file' | 'diff' } | null;
  onOpenPathHandled?: () => void;
  /** Insert a recipe prompt into the chat composer. */
  onUsePrompt?: (prompt: string, mode?: 'ask' | 'plan' | 'agent') => void;
  onRestartEngine?: () => Promise<void>;
  /** Active provider profile (required to create/save skills). */
  activeProfileName?: string | null;
  hasActiveProfile?: boolean;
  onOpenProfiles?: () => void;
  /** Bubble Code Review findings to the chat composer strip. */
  onReviewFindingsChange?: (findings: import('../shared/reviewFindings.js').ReviewFinding[]) => void;
}

type TreeEntry = { name: string; path: string; kind: 'file' | 'dir' };

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

type ClipboardState = {
  paths: string[];
  mode: 'copy' | 'cut';
};

type CreateDraft = {
  parent: string;
  kind: 'file' | 'dir';
  name: string;
};

function fileName(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || path;
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i < 0 ? '' : path.slice(0, i);
}

/** Workspace folder name only (VS Code explorer root), not a truncated path. */
function workspaceFolderName(workspaceRoot: string): string {
  const parts = workspaceRoot.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] || workspaceRoot || 'Workspace';
}

function remapUnder(oldPath: string, newPath: string, path: string): string {
  if (path === oldPath) return newPath;
  if (path.startsWith(`${oldPath}/`)) {
    return `${newPath}${path.slice(oldPath.length)}`;
  }
  return path;
}

function isMacPlatform(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    /Mac|iPhone|iPad|iPod/i.test(navigator.platform)
  );
}

function revealLabel(): string {
  if (typeof navigator === 'undefined') return 'Reveal in File Manager';
  if (/Mac|iPhone|iPad|iPod/i.test(navigator.platform)) {
    return 'Reveal in Finder';
  }
  if (/Win/i.test(navigator.platform)) return 'Reveal in File Explorer';
  return 'Reveal in File Manager';
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
    'explorer' | 'git' | 'mcp' | 'skills' | 'recipes' | 'automations'
  >('explorer');
  const side = props.side ?? internalSide;
  const setSide = (
    next: 'explorer' | 'git' | 'mcp' | 'skills' | 'recipes' | 'automations',
  ) => {
    if (props.onSideChange) props.onSideChange(next);
    else setInternalSide(next);
  };
  const [rootEntries, setRootEntries] = useState<TreeEntry[]>([]);
  const [childrenByPath, setChildrenByPath] = useState<
    Record<string, TreeEntry[]>
  >({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [workspaceRootOpen, setWorkspaceRootOpen] = useState(true);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set());
  const [tabs, setTabs] = useState<OpenTab[]>([]);
  const [activePath, setActivePath] = useState<string | null>(null);

  useEffect(() => {
    if (!props.onEditorContextChange) return;
    const openPaths = tabs
      .filter((t) => t.mode === 'file' && !t.path.startsWith('diff:'))
      .map((t) => t.path);
    const active =
      activePath && !activePath.startsWith('diff:') ? activePath : null;
    props.onEditorContextChange({ activePath: active, openPaths });
  }, [activePath, tabs, props.onEditorContextChange]);

  const [git, setGit] = useState<GitWorkingTreeSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [sideWidth, setSideWidth] = usePersistedWidth('mitii.desktop.explorerWidth', {
    initial: 260,
    min: 160,
    max: 520,
  });
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const createInputRef = useRef<HTMLInputElement | null>(null);

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
    setWorkspaceRootOpen(true);
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
      props.onFileSaved?.(active.path);
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

  useEffect(() => {
    if (!createDraft) return;
    createInputRef.current?.focus();
    createInputRef.current?.select();
  }, [createDraft]);

  const resolveTargetDir = useCallback(
    (paths: string[]): string => {
      if (paths.length === 0) return '';
      const first = paths[0]!;
      const entry = entryByPath.get(first);
      if (entry?.kind === 'dir') return first;
      return parentOf(first);
    },
    [entryByPath],
  );

  const applyPathMoves = useCallback(
    (results: Array<{ from: string; to: string }>) => {
      const moved = results.filter((r) => r.from !== r.to);
      if (moved.length === 0) return;

      setExpanded((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          let cur = p;
          for (const { from, to } of moved) cur = remapUnder(from, to, cur);
          next.add(cur);
        }
        return next;
      });

      setChildrenByPath((prev) => {
        const next: Record<string, TreeEntry[]> = {};
        for (const [key, value] of Object.entries(prev)) {
          let nextKey = key;
          for (const { from, to } of moved) {
            nextKey = remapUnder(from, to, nextKey);
          }
          next[nextKey] = value.map((entry) => {
            let path = entry.path;
            for (const { from, to } of moved) {
              path = remapUnder(from, to, path);
            }
            return {
              ...entry,
              path,
              name: fileName(path),
            };
          });
        }
        return next;
      });

      setTabs((prev) =>
        prev.map((t) => {
          if (t.mode === 'diff') {
            const filePath = t.path.replace(/^diff:/, '');
            let nextFile = filePath;
            for (const { from, to } of moved) {
              nextFile = remapUnder(from, to, nextFile);
            }
            return nextFile === filePath ? t : { ...t, path: `diff:${nextFile}` };
          }
          let path = t.path;
          for (const { from, to } of moved) {
            path = remapUnder(from, to, path);
          }
          return path === t.path ? t : { ...t, path };
        }),
      );

      setActivePath((cur) => {
        if (!cur) return cur;
        if (cur.startsWith('diff:')) {
          let filePath = cur.replace(/^diff:/, '');
          for (const { from, to } of moved) {
            filePath = remapUnder(from, to, filePath);
          }
          return `diff:${filePath}`;
        }
        let path = cur;
        for (const { from, to } of moved) {
          path = remapUnder(from, to, path);
        }
        return path;
      });

      setSelectedPaths((prev) => {
        const next = new Set<string>();
        for (const p of prev) {
          let cur = p;
          for (const { from, to } of moved) cur = remapUnder(from, to, cur);
          next.add(cur);
        }
        return next;
      });
    },
    [],
  );

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

  const setClipboardFromSelection = (paths: string[], mode: 'copy' | 'cut') => {
    if (paths.length === 0) return;
    setClipboard({ paths: [...paths], mode });
    setContextMenu(null);
    setNote(mode === 'cut' ? 'Cut' : 'Copied');
    window.setTimeout(() => setNote(null), 1000);
  };

  const cancelCut = () => {
    if (clipboard?.mode === 'cut') setClipboard(null);
  };

  const beginCreate = async (kind: 'file' | 'dir', paths?: string[]) => {
    setContextMenu(null);
    setRenamingPath(null);
    const parent = resolveTargetDir(paths ?? [...selectedPaths]);
    setWorkspaceRootOpen(true);
    if (parent) {
      setExpanded((prev) => new Set(prev).add(parent));
      if (!childrenByPath[parent]) await loadDir(parent);
    }
    setCreateDraft({
      parent,
      kind,
      name: kind === 'file' ? 'untitled.txt' : 'New Folder',
    });
  };

  const commitCreate = async () => {
    if (!createDraft) return;
    const name = createDraft.name.trim();
    if (!name) {
      setCreateDraft(null);
      return;
    }
    const kind = createDraft.kind;
    try {
      const created =
        kind === 'file'
          ? await createWorkspaceFilePath({
              ...auth,
              parent: createDraft.parent,
              name,
            })
          : await createWorkspaceFolderPath({
              ...auth,
              parent: createDraft.parent,
              name,
            });
      setCreateDraft(null);
      await refreshParents([created.path]);
      setSelectedPaths(new Set([created.path]));
      setSelectionAnchor(created.path);
      if (kind === 'file') void openFile(created.path);
      else setExpanded((prev) => new Set(prev).add(created.path));
      void loadGit();
      setNote(kind === 'file' ? 'File created' : 'Folder created');
      window.setTimeout(() => setNote(null), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setCreateDraft(null);
    }
  };

  const pasteClipboard = async (targetPaths?: string[]) => {
    if (!clipboard || clipboard.paths.length === 0) return;
    setContextMenu(null);
    const mode = clipboard.mode;
    const destDir = resolveTargetDir(targetPaths ?? [...selectedPaths]);
    try {
      const result =
        mode === 'cut'
          ? await moveWorkspacePaths({
              ...auth,
              paths: clipboard.paths,
              destDir,
            })
          : await copyWorkspacePaths({
              ...auth,
              paths: clipboard.paths,
              destDir,
            });
      if (mode === 'cut') {
        applyPathMoves(result.results);
        setClipboard(null);
      }
      const touched = [
        ...clipboard.paths,
        ...result.results.map((r) => r.to),
        destDir,
      ];
      await refreshParents(touched);
      if (destDir) {
        setExpanded((prev) => new Set(prev).add(destDir));
        await loadDir(destDir);
      } else {
        await loadDir('');
      }
      const created = result.results.map((r) => r.to);
      if (created.length > 0) {
        setSelectedPaths(new Set(created));
        setSelectionAnchor(created[0] ?? null);
      }
      void loadGit();
      setNote(mode === 'cut' ? 'Moved' : 'Pasted');
      window.setTimeout(() => setNote(null), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const revealInOs = async (paths: string[]) => {
    setContextMenu(null);
    if (paths.length === 0) return;
    const bridge = getDesktopBridge();
    if (!bridge?.revealInFolder) {
      setError('Reveal is unavailable in this shell');
      return;
    }
    try {
      const absolute = await fetchAbsoluteWorkspacePath({
        ...auth,
        path: paths[0]!,
      });
      const result = await bridge.revealInFolder(absolute);
      if (!result.ok) setError(result.reason ?? 'reveal_failed');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const beginRename = (path: string) => {
    setContextMenu(null);
    setCreateDraft(null);
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
      applyPathMoves([{ from: oldPath, to: result.path }]);
      setSelectedPaths(new Set([result.path]));
      setSelectionAnchor(result.path);
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
      paths.length === 1 ? fileName(paths[0]!) : `${paths.length} items`;
    const ok = window.confirm(`Delete ${label}? This cannot be undone.`);
    if (!ok) return;
    try {
      await deleteWorkspacePaths({ ...auth, paths });
      closeTabsMatching(paths);
      setSelectedPaths(new Set());
      setSelectionAnchor(null);
      if (clipboard) {
        const remaining = clipboard.paths.filter((p) => !paths.includes(p));
        setClipboard(
          remaining.length > 0 ? { ...clipboard, paths: remaining } : null,
        );
      }
      await refreshParents(paths);
      void loadGit();
      setNote('Deleted');
      window.setTimeout(() => setNote(null), 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const renderCreateRow = (parent: string, depth: number) => {
    if (!createDraft || createDraft.parent !== parent) return null;
    return (
      <div
        key={`__create__:${parent}`}
        className="explorer-row explorer-row--rename"
        style={{ paddingLeft: 4 + depth * 8 }}
      >
        <span className="explorer-twist" aria-hidden />
        <span className="explorer-icon" aria-hidden>
          {createDraft.kind === 'dir' ? (
            <IconFolder size={16} />
          ) : (
            <IconFile size={16} />
          )}
        </span>
        <input
          ref={createInputRef}
          className="explorer-rename"
          value={createDraft.name}
          aria-label={
            createDraft.kind === 'file' ? 'New file name' : 'New folder name'
          }
          onChange={(e) =>
            setCreateDraft((prev) =>
              prev ? { ...prev, name: e.target.value } : prev,
            )
          }
          onBlur={() => void commitCreate()}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void commitCreate();
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setCreateDraft(null);
            }
          }}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
    );
  };

  const renderTree = (entries: TreeEntry[], depth: number, parentPath: string) => (
    <>
      {renderCreateRow(parentPath, depth)}
      {entries.map((entry) => {
        const isOpen = expanded.has(entry.path);
        const kids = childrenByPath[entry.path];
        const isSelected = selectedPaths.has(entry.path);
        const isActive =
          active?.mode === 'file' && active.path === entry.path;
        const isRenaming = renamingPath === entry.path;
        const isCut =
          clipboard?.mode === 'cut' && clipboard.paths.includes(entry.path);
        return (
          <div key={entry.path} className="explorer-node">
            {isRenaming ? (
              <div
                className="explorer-row explorer-row--rename"
                style={{ paddingLeft: 4 + depth * 8 }}
              >
                <span className="explorer-twist" aria-hidden />
                <span className="explorer-icon" aria-hidden>
                  {entry.kind === 'dir' ? (
                    <IconFolder size={16} />
                  ) : (
                    <IconFile size={16} />
                  )}
                </span>
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
                  onClick={(e) => e.stopPropagation()}
                />
              </div>
            ) : (
              <button
                type="button"
                className={`explorer-row${isSelected || isActive ? ' is-active' : ''}${
                  isSelected ? ' is-selected' : ''
                }${isCut ? ' is-cut' : ''}`}
                style={{ paddingLeft: 4 + depth * 8 }}
                onClick={(e) => onExplorerClick(entry, e)}
                onContextMenu={(e) => onExplorerContextMenu(entry, e)}
                title={entry.path}
              >
                <span className="explorer-twist" aria-hidden>
                  {entry.kind === 'dir' ? (
                    loadingDirs.has(entry.path) ? (
                      <IconEllipsis size={12} />
                    ) : isOpen ? (
                      <IconChevronDown size={12} />
                    ) : (
                      <IconChevronRight size={12} />
                    )
                  ) : null}
                </span>
                <span
                  className={`explorer-icon explorer-icon--${entry.kind}${
                    entry.kind === 'dir' && isOpen ? ' is-open' : ''
                  }`}
                  aria-hidden
                >
                  {entry.kind === 'dir' ? (
                    isOpen ? (
                      <IconFolderOpen size={16} />
                    ) : (
                      <IconFolder size={16} />
                    )
                  ) : (
                    <IconFile size={16} />
                  )}
                </span>
                <span className="explorer-label">{entry.name}</span>
              </button>
            )}
            {entry.kind === 'dir' && isOpen && kids
              ? renderTree(kids, depth + 1, entry.path)
              : entry.kind === 'dir' && isOpen
                ? renderCreateRow(entry.path, depth + 1)
                : null}
          </div>
        );
      })}
    </>
  );

  const menuPaths = contextMenu?.paths ?? [];
  const menuSingle = menuPaths.length === 1 ? menuPaths[0] : null;
  const menuEntry = menuSingle ? entryByPath.get(menuSingle) : undefined;

  const crumbs = active
    ? (active.mode === 'diff'
        ? active.path.replace(/^diff:/, '')
        : active.path
      ).split('/')
    : [];

  const workspaceLabel = workspaceFolderName(props.workspaceRoot);
  const extensionsFullscreen =
    side === 'mcp' ||
    side === 'skills' ||
    side === 'recipes' ||
    side === 'automations';
  const sideColumnWidth = extensionsFullscreen
    ? props.hideActivityRail
      ? 0
      : 44
    : sideWidth;

  return (
    <div className={`workspace-view${props.embedded ? ' workspace-view--embedded' : ''}`}>
      <div
        className="workspace-body"
        style={
          {
            gridTemplateColumns: extensionsFullscreen
              ? `${sideColumnWidth}px 0 minmax(0, 1fr)`
              : `${sideWidth}px 5px minmax(0, 1fr)`,
          } as CSSProperties
        }
      >
        <aside
          className={`workspace-side${props.hideActivityRail ? ' workspace-side--flush' : ''}${
            extensionsFullscreen ? ' workspace-side--rail-only' : ''
          }`}
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
                <IconFiles size={20} />
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
                <IconGit size={20} />
                {git?.files.length ? (
                  <em className="activity-badge">{git.files.length}</em>
                ) : null}
              </button>
            </div>
          )}

          {extensionsFullscreen ? null : (
          <div className="workspace-pane">
            {side === 'explorer' ? (
              <>
                <div className="workspace-pane__title">
                  <span>Explorer</span>
                  <div className="workspace-pane__actions">
                    <button
                      type="button"
                      className="icon-quiet"
                      title="New File..."
                      aria-label="New File"
                      onClick={() => void beginCreate('file')}
                    >
                      <IconNewFile size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-quiet"
                      title="New Folder..."
                      aria-label="New Folder"
                      onClick={() => void beginCreate('dir')}
                    >
                      <IconNewFolder size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-quiet"
                      title="Refresh Explorer"
                      aria-label="Refresh Explorer"
                      onClick={() => {
                        setChildrenByPath({});
                        void loadDir('');
                      }}
                    >
                      <IconRefresh size={16} />
                    </button>
                    <button
                      type="button"
                      className="icon-quiet"
                      title="Collapse Folders in Explorer"
                      aria-label="Collapse Folders in Explorer"
                      onClick={() => {
                        setExpanded(new Set());
                        setWorkspaceRootOpen(true);
                      }}
                    >
                      <IconCollapseAll size={16} />
                    </button>
                  </div>
                </div>
                <div
                  className="explorer-tree"
                  tabIndex={0}
                  onContextMenu={(e) => {
                    if (e.target !== e.currentTarget) return;
                    e.preventDefault();
                    setSelectedPaths(new Set());
                    setSelectionAnchor(null);
                    setContextMenu({ x: e.clientX, y: e.clientY, paths: [] });
                  }}
                  onKeyDown={(e) => {
                    if (e.target instanceof HTMLInputElement) return;
                    const mod = e.metaKey || e.ctrlKey;
                    const paths = [...selectedPaths];
                    if (mod && e.key.toLowerCase() === 'c' && paths.length > 0) {
                      e.preventDefault();
                      setClipboardFromSelection(paths, 'copy');
                      return;
                    }
                    if (mod && e.key.toLowerCase() === 'x' && paths.length > 0) {
                      e.preventDefault();
                      setClipboardFromSelection(paths, 'cut');
                      return;
                    }
                    if (mod && e.key.toLowerCase() === 'v') {
                      e.preventDefault();
                      void pasteClipboard(paths);
                      return;
                    }
                    if (e.key === 'Escape') {
                      cancelCut();
                      setContextMenu(null);
                      return;
                    }
                    if (
                      (e.key === 'Delete' ||
                        (e.key === 'Backspace' && (e.metaKey || !isMacPlatform()))) &&
                      paths.length > 0
                    ) {
                      e.preventDefault();
                      void deleteSelected(paths);
                      return;
                    }
                    if (e.key === 'F2' && paths.length === 1) {
                      e.preventDefault();
                      beginRename(paths[0]!);
                      return;
                    }
                    if (
                      isMacPlatform() &&
                      e.key === 'Enter' &&
                      paths.length === 1 &&
                      !mod
                    ) {
                      e.preventDefault();
                      beginRename(paths[0]!);
                    }
                  }}
                >
                  <button
                    type="button"
                    className="explorer-row explorer-row--workspace-root"
                    title={props.workspaceRoot}
                    onClick={() => setWorkspaceRootOpen((v) => !v)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setSelectedPaths(new Set());
                      setSelectionAnchor(null);
                      setContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        paths: [],
                      });
                    }}
                  >
                    <span className="explorer-twist" aria-hidden>
                      {workspaceRootOpen ? (
                        <IconChevronDown size={12} />
                      ) : (
                        <IconChevronRight size={12} />
                      )}
                    </span>
                    <span
                      className={`explorer-icon explorer-icon--dir${
                        workspaceRootOpen ? ' is-open' : ''
                      }`}
                      aria-hidden
                    >
                      {workspaceRootOpen ? (
                        <IconFolderOpen size={16} />
                      ) : (
                        <IconFolder size={16} />
                      )}
                    </span>
                    <span className="explorer-label explorer-label--root">
                      {workspaceLabel}
                    </span>
                  </button>
                  {workspaceRootOpen
                    ? rootEntries.length === 0 && !createDraft
                      ? (
                          <p className="workspace-empty">No files</p>
                        )
                      : (
                          renderTree(rootEntries, 1, '')
                        )
                    : null}
                </div>
              </>
            ) : side === 'git' ? (
              <GitWorkingTreePane
                baseUrl={props.baseUrl}
                token={props.token}
                activePath={activePath}
                onOpenDiff={openDiff}
                onOpenFile={openFile}
                onGitCountChange={(count) => {
                  props.onGitCountChange?.(count);
                }}
                onStatusSnapshot={(next) => {
                  setGit(next);
                  props.onGitCountChange?.(next.files.length);
                }}
                onUsePrompt={props.onUsePrompt}
                onStatusNote={setNote}
                onError={setError}
                onFindingsChange={props.onReviewFindingsChange}
              />
            ) : null}
          </div>
          )}
        </aside>

        {extensionsFullscreen ? (
          <div aria-hidden className="workspace-resize-spacer" />
        ) : (
          <ResizeHandle
            value={sideWidth}
            onChange={setSideWidth}
            min={160}
            max={520}
            label="Resize explorer"
          />
        )}

        <section
          className={`editor-shell${
            extensionsFullscreen ? ' editor-shell--extensions' : ''
          }`}
        >
          {side === 'mcp' ? (
            <McpManager
              baseUrl={props.baseUrl}
              token={props.token}
              onRestartEngine={props.onRestartEngine}
            />
          ) : side === 'skills' ? (
            <SkillsManager
              baseUrl={props.baseUrl}
              token={props.token}
              activeProfileName={props.activeProfileName}
              hasActiveProfile={Boolean(props.hasActiveProfile)}
              onOpenProfiles={props.onOpenProfiles}
            />
          ) : side === 'recipes' ? (
            <RecipesManager
              baseUrl={props.baseUrl}
              token={props.token}
              onUsePrompt={props.onUsePrompt}
            />
          ) : side === 'automations' ? (
            <AutomationsPanel
              specs={props.automations?.specs ?? []}
              runs={props.automations?.runs ?? []}
              loading={props.automations?.loading}
              error={props.automations?.error}
              onRefresh={
                props.automations?.onRefresh ?? (() => undefined)
              }
              onTrigger={props.automations?.onTrigger ?? (() => undefined)}
              onPause={props.automations?.onPause ?? (() => undefined)}
              onResume={props.automations?.onResume ?? (() => undefined)}
            />
          ) : (
            <>
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
            </>
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
          <button
            type="button"
            role="menuitem"
            onClick={() => void beginCreate('file', menuPaths)}
          >
            New File...
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void beginCreate('dir', menuPaths)}
          >
            New Folder...
          </button>
          <hr />
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
          {menuPaths.length > 0 ? (
            <>
              <button
                type="button"
                role="menuitem"
                onClick={() => setClipboardFromSelection(menuPaths, 'cut')}
              >
                Cut
                <kbd className="explorer-menu__kbd">{isMacPlatform() ? '⌘X' : 'Ctrl+X'}</kbd>
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => setClipboardFromSelection(menuPaths, 'copy')}
              >
                Copy
                <kbd className="explorer-menu__kbd">{isMacPlatform() ? '⌘C' : 'Ctrl+C'}</kbd>
              </button>
            </>
          ) : null}
          <button
            type="button"
            role="menuitem"
            disabled={!clipboard}
            onClick={() => void pasteClipboard(menuPaths)}
          >
            Paste
            <kbd className="explorer-menu__kbd">{isMacPlatform() ? '⌘V' : 'Ctrl+V'}</kbd>
          </button>
          <hr />
          {menuPaths.length > 0 ? (
            <>
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
              <button
                type="button"
                role="menuitem"
                onClick={() => void revealInOs(menuPaths)}
              >
                {revealLabel()}
              </button>
              <hr />
            </>
          ) : null}
          {menuSingle ? (
            <button
              type="button"
              role="menuitem"
              onClick={() => beginRename(menuSingle)}
            >
              Rename
              <kbd className="explorer-menu__kbd">{isMacPlatform() ? 'Enter' : 'F2'}</kbd>
            </button>
          ) : null}
          {menuPaths.length > 0 ? (
            <button
              type="button"
              role="menuitem"
              className="explorer-menu__danger"
              onClick={() => void deleteSelected(menuPaths)}
            >
              Delete
              <kbd className="explorer-menu__kbd">{isMacPlatform() ? '⌘⌫' : 'Del'}</kbd>
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
