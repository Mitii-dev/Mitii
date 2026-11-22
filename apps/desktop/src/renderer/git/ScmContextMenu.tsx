import type { GitWorkingTreeFile } from '../../shared/git/workingTree.js';
import type { ContextMenuState } from './scmTypes.js';

interface ScmContextMenuProps {
  menu: ContextMenuState;
  fileByPath: ReadonlyMap<string, GitWorkingTreeFile>;
  untrackedPathSet: ReadonlySet<string>;
  disabled: boolean;
  onClose: () => void;
  onStage: (paths: string[]) => void;
  onUnstage: (paths: string[]) => void;
  onStash: (paths: string[], includeUntracked: boolean) => void;
}

export function ScmContextMenu(props: ScmContextMenuProps) {
  const { menu, fileByPath, untrackedPathSet, disabled } = props;
  const menuPaths = menu.paths;
  const isUnstagedPath = (p: string) => {
    const g = fileByPath.get(p)?.group;
    return g === 'changes' || g === 'untracked';
  };
  const isStagedPath = (p: string) => fileByPath.get(p)?.group === 'staged';
  const menuHasStaged = menuPaths.some(isStagedPath);
  const menuHasUnstaged = menuPaths.some(isUnstagedPath);
  const menuHasUntracked = menuPaths.some((p) => untrackedPathSet.has(p));
  const countSuffix = menuPaths.length > 1 ? ` (${menuPaths.length})` : '';

  return (
    <div
      className="explorer-menu scm-context-menu"
      style={{ left: menu.x, top: menu.y }}
      role="menu"
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        disabled={!menuHasUnstaged || disabled}
        onClick={() => {
          const paths = menuPaths.filter(isUnstagedPath);
          props.onClose();
          if (paths.length === 0) return;
          props.onStage(paths);
        }}
      >
        Stage
        {countSuffix}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={!menuHasStaged || disabled}
        onClick={() => {
          const paths = menuPaths.filter(isStagedPath);
          props.onClose();
          if (paths.length === 0) return;
          props.onUnstage(paths);
        }}
      >
        Unstage
        {countSuffix}
      </button>
      <button
        type="button"
        role="menuitem"
        disabled={menuPaths.length === 0 || disabled}
        onClick={() => {
          const paths = [...menuPaths];
          props.onClose();
          if (paths.length === 0) return;
          props.onStash(paths, menuHasUntracked);
        }}
      >
        Stash
        {countSuffix}
      </button>
    </div>
  );
}
