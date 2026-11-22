import { useCallback, useState, type KeyboardEvent, type MouseEvent } from 'react';

import {
  copyWorkspacePaths,
  createWorkspaceFilePath,
  createWorkspaceFolderPath,
  deleteWorkspacePaths,
  fetchAbsoluteWorkspacePath,
  getDesktopBridge,
  moveWorkspacePaths,
  renameWorkspacePath,
} from '../../api.js';
import type {
  ClipboardState,
  ContextMenuState,
  CreateDraft,
  PathMove,
  TreeEntry,
} from '../explorerTypes.js';
import { fileName, isMacPlatform, parentOf, remapUnder } from '../pathUtils.js';
import type { EditorTabsModel } from './useEditorTabs.js';
import type { ExplorerTreeModel } from './useExplorerTree.js';

export interface UseExplorerFsOpsOptions {
  baseUrl: string;
  token?: string;
  tree: ExplorerTreeModel;
  editor: Pick<
    EditorTabsModel,
    'openFile' | 'closeTabsMatching' | 'remapPaths'
  >;
  onError: (message: string | null) => void;
  onNote: (note: string | null) => void;
  /** Refresh git status after a mutation. */
  onGitChanged: () => void;
}

export function useExplorerFsOps(options: UseExplorerFsOpsOptions) {
  const { baseUrl, token, tree, editor, onError, onNote, onGitChanged } =
    options;
  const auth = { baseUrl, token };
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [createDraft, setCreateDraft] = useState<CreateDraft | null>(null);
  const [clipboard, setClipboard] = useState<ClipboardState | null>(null);

  const fail = (err: unknown) =>
    onError(err instanceof Error ? err.message : String(err));
  const flashNote = (text: string, ms = 1200) => {
    onNote(text);
    window.setTimeout(() => onNote(null), ms);
  };

  const resolveTargetDir = useCallback(
    (paths: string[]): string => {
      if (paths.length === 0) return '';
      const first = paths[0]!;
      const entry = tree.entryByPath.get(first);
      if (entry?.kind === 'dir') return first;
      return parentOf(first);
    },
    [tree.entryByPath],
  );

  const clearSelection = () => {
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
  };

  const selectOnly = (path: string) => {
    setSelectedPaths(new Set([path]));
    setSelectionAnchor(path);
  };

  const applyPathMoves = useCallback(
    (results: PathMove[]) => {
      const moved = results.filter((r) => r.from !== r.to);
      if (moved.length === 0) return;
      tree.remapPaths(moved);
      editor.remapPaths(moved);
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
    [tree.remapPaths, editor.remapPaths],
  );

  const selectRange = (anchor: string, target: string) => {
    const paths = tree.visibleEntries.map((e) => e.path);
    const a = paths.indexOf(anchor);
    const b = paths.indexOf(target);
    if (a < 0 || b < 0) {
      setSelectedPaths(new Set([target]));
      return;
    }
    const [lo, hi] = a < b ? [a, b] : [b, a];
    setSelectedPaths(new Set(paths.slice(lo, hi + 1)));
  };

  const onEntryClick = (entry: TreeEntry, e: MouseEvent<HTMLButtonElement>) => {
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

    selectOnly(entry.path);
    if (entry.kind === 'dir') void tree.toggleDir(entry.path);
    else void editor.openFile(entry.path, { preview: true });
  };

  const onEntryDoubleClick = (
    entry: TreeEntry,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    if (entry.kind !== 'file') return;
    e.preventDefault();
    selectOnly(entry.path);
    void editor.openFile(entry.path, { pin: true });
  };

  const onEntryMouseDown = (
    entry: TreeEntry,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    if (e.button !== 0) return;
    if (!(e.metaKey || e.ctrlKey || e.shiftKey)) return;
    // Handle modifier selection on mousedown so Ctrl/Shift aren't lost to focus/click races.
    e.preventDefault();
    onEntryClick(entry, e);
  };

  const onEntryContextMenu = (
    entry: TreeEntry,
    e: MouseEvent<HTMLButtonElement>,
  ) => {
    // macOS Control+click opens the context menu; multi-select uses ⌘ there.
    // On Win/Linux, Ctrl+click is multi-select — don't let a synthetic menu clear it.
    if ((e.ctrlKey || e.metaKey) && !isMacPlatform()) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    let paths = [...selectedPaths];
    if (!selectedPaths.has(entry.path)) {
      paths = [entry.path];
      selectOnly(entry.path);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, paths });
  };

  /** Right-click on empty tree space or the workspace root row. */
  const openRootContextMenu = (x: number, y: number) => {
    clearSelection();
    setContextMenu({ x, y, paths: [] });
  };

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      flashNote('Copied');
    } catch (err) {
      fail(err);
    }
  };

  const copyRelativePaths = (paths: string[]) => copyText(paths.join('\n'));

  const copyAbsolutePaths = async (paths: string[]) => {
    const abs = await Promise.all(
      paths.map((path) => fetchAbsoluteWorkspacePath({ ...auth, path })),
    );
    await copyText(abs.join('\n'));
  };

  const copyNames = (paths: string[]) =>
    copyText(paths.map(fileName).join('\n'));

  const setClipboardFromSelection = (paths: string[], mode: 'copy' | 'cut') => {
    if (paths.length === 0) return;
    setClipboard({ paths: [...paths], mode });
    setContextMenu(null);
    flashNote(mode === 'cut' ? 'Cut' : 'Copied', 1000);
  };

  const cancelCut = () => {
    if (clipboard?.mode === 'cut') setClipboard(null);
  };

  const beginCreate = async (kind: 'file' | 'dir', paths?: string[]) => {
    setContextMenu(null);
    setRenamingPath(null);
    const parent = resolveTargetDir(paths ?? [...selectedPaths]);
    tree.setWorkspaceRootOpen(true);
    if (parent) {
      tree.expandPath(parent);
      if (!tree.childrenByPath[parent]) await tree.loadDir(parent);
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
      await tree.refreshParents([created.path]);
      selectOnly(created.path);
      if (kind === 'file') void editor.openFile(created.path, { pin: true });
      else tree.expandPath(created.path);
      onGitChanged();
      flashNote(kind === 'file' ? 'File created' : 'Folder created');
    } catch (err) {
      fail(err);
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
      await tree.refreshParents(touched);
      if (destDir) {
        tree.expandPath(destDir);
        await tree.loadDir(destDir);
      } else {
        await tree.loadDir('');
      }
      const created = result.results.map((r) => r.to);
      if (created.length > 0) {
        setSelectedPaths(new Set(created));
        setSelectionAnchor(created[0] ?? null);
      }
      onGitChanged();
      flashNote(mode === 'cut' ? 'Moved' : 'Pasted');
    } catch (err) {
      fail(err);
    }
  };

  const revealInOs = async (paths: string[]) => {
    setContextMenu(null);
    if (paths.length === 0) return;
    const bridge = getDesktopBridge();
    if (!bridge?.revealInFolder) {
      onError('Reveal is unavailable in this shell');
      return;
    }
    try {
      const absolute = await fetchAbsoluteWorkspacePath({
        ...auth,
        path: paths[0]!,
      });
      const result = await bridge.revealInFolder(absolute);
      if (!result.ok) onError(result.reason ?? 'reveal_failed');
    } catch (err) {
      fail(err);
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
      selectOnly(result.path);
      await tree.refreshParents([oldPath, result.path]);
      onGitChanged();
    } catch (err) {
      fail(err);
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
      editor.closeTabsMatching(paths);
      clearSelection();
      if (clipboard) {
        const remaining = clipboard.paths.filter((p) => !paths.includes(p));
        setClipboard(
          remaining.length > 0 ? { ...clipboard, paths: remaining } : null,
        );
      }
      await tree.refreshParents(paths);
      onGitChanged();
      flashNote('Deleted');
    } catch (err) {
      fail(err);
    }
  };

  const onTreeKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
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
  };

  return {
    selectedPaths,
    contextMenu,
    setContextMenu,
    renamingPath,
    setRenamingPath,
    renameValue,
    setRenameValue,
    createDraft,
    setCreateDraft,
    clipboard,
    onEntryClick,
    onEntryDoubleClick,
    onEntryMouseDown,
    onEntryContextMenu,
    openRootContextMenu,
    onTreeKeyDown,
    copyAbsolutePaths,
    copyRelativePaths,
    copyNames,
    setClipboardFromSelection,
    beginCreate,
    commitCreate,
    pasteClipboard,
    revealInOs,
    beginRename,
    commitRename,
    deleteSelected,
  };
}

export type ExplorerFsOpsModel = ReturnType<typeof useExplorerFsOps>;
