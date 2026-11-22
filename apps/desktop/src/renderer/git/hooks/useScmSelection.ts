import {
  useCallback,
  useEffect,
  useState,
  type MouseEvent as ReactMouseEvent,
} from 'react';

import type { GitWorkingTreeFile } from '../../../shared/git/workingTree.js';
import type { ContextMenuState, ScmGroupKey } from '../scmTypes.js';

export function useScmSelection() {
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [selectionAnchor, setSelectionAnchor] = useState<string | null>(null);
  const [selectionGroup, setSelectionGroup] = useState<ScmGroupKey | null>(
    null,
  );
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(
    null,
  );

  const pruneSelection = useCallback((valid: ReadonlySet<string>) => {
    setSelectedPaths((prev) => {
      const pruned = [...prev].filter((p) => valid.has(p));
      if (pruned.length === prev.size) return prev;
      return new Set(pruned);
    });
  }, []);

  const clearSelection = () => {
    setSelectedPaths(new Set());
    setSelectionAnchor(null);
    setSelectionGroup(null);
  };

  const pathsForAction = (path: string, files: GitWorkingTreeFile[]) => {
    const groupPaths = new Set(files.map((f) => f.path));
    if (selectedPaths.has(path) && selectedPaths.size > 1) {
      const multi = [...selectedPaths].filter((p) => groupPaths.has(p));
      if (multi.length > 0) return multi;
    }
    return [path];
  };

  const selectInGroup = (
    group: ScmGroupKey,
    files: GitWorkingTreeFile[],
    path: string,
    e: ReactMouseEvent,
  ) => {
    const multi = e.metaKey || e.ctrlKey;
    const range = e.shiftKey;
    const paths = files.map((f) => f.path);

    if (range && selectionAnchor && selectionGroup === group) {
      const a = paths.indexOf(selectionAnchor);
      const b = paths.indexOf(path);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        setSelectedPaths(new Set(paths.slice(lo, hi + 1)));
        return;
      }
    }

    if (multi) {
      setSelectedPaths((prev) => {
        const next = new Set(selectionGroup === group ? prev : []);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });
      setSelectionAnchor(path);
      setSelectionGroup(group);
      return;
    }

    setSelectedPaths(new Set([path]));
    setSelectionAnchor(path);
    setSelectionGroup(group);
  };

  const openContextMenu = (
    e: ReactMouseEvent,
    group: ScmGroupKey,
    files: GitWorkingTreeFile[],
    path: string,
  ) => {
    e.preventDefault();
    e.stopPropagation();
    let paths: string[];
    if (selectedPaths.has(path) && selectedPaths.size > 1) {
      const groupPaths = new Set(files.map((f) => f.path));
      paths = [...selectedPaths].filter((p) => groupPaths.has(p));
      if (paths.length === 0) paths = [path];
    } else {
      paths = [path];
      setSelectedPaths(new Set([path]));
      setSelectionAnchor(path);
      setSelectionGroup(group);
    }
    setContextMenu({ x: e.clientX, y: e.clientY, paths });
  };

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('click', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('click', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [contextMenu]);

  return {
    selectedPaths,
    contextMenu,
    setContextMenu,
    pruneSelection,
    clearSelection,
    pathsForAction,
    selectInGroup,
    openContextMenu,
  };
}
