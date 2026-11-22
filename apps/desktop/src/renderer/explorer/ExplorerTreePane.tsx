import { useEffect, useMemo, useRef, useState } from 'react';

import { TopBranchSelect } from '../git/TopBranchSelect.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconCollapseAll,
  IconFolder,
  IconFolderOpen,
  IconNewFile,
  IconNewFolder,
  IconRefresh,
} from '../shell/ActivityIcons.js';
import {
  ExplorerCreateRow,
  ExplorerFlatEntry,
  ExplorerVirtualTree,
} from './ExplorerTreeRows.js';
import { flattenVisible } from './flattenVisible.js';
import type { FlatRow } from './explorerTypes.js';
import type { ExplorerFsOpsModel } from './hooks/useExplorerFsOps.js';
import type { ExplorerTreeModel } from './hooks/useExplorerTree.js';
import { workspaceFolderName } from './pathUtils.js';

export interface ExplorerTreePaneProps {
  baseUrl: string;
  token?: string;
  workspaceRoot: string;
  tree: ExplorerTreeModel;
  fsOps: ExplorerFsOpsModel;
  /** Active file tab path (null for diff tabs / no tab). */
  activeFilePath: string | null;
  agentBusy?: boolean;
  onRefresh: () => void;
  onBranchChanged: () => void;
}

export function ExplorerTreePane(props: ExplorerTreePaneProps) {
  const { tree, fsOps } = props;
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(480);
  const treeRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = treeRef.current;
    if (!el) return;
    const sync = () => setViewportHeight(el.clientHeight || 480);
    sync();
    const ro =
      typeof ResizeObserver !== 'undefined' ? new ResizeObserver(sync) : null;
    ro?.observe(el);
    return () => ro?.disconnect();
  }, [tree.workspaceRootOpen, props.workspaceRoot]);

  const rows = useMemo(
    () =>
      flattenVisible(
        tree.rootEntries,
        tree.childrenByPath,
        tree.expanded,
        fsOps.createDraft,
      ),
    [tree.rootEntries, tree.childrenByPath, tree.expanded, fsOps.createDraft],
  );

  const renderRow = (row: FlatRow) => {
    if (row.type === 'create') {
      if (!fsOps.createDraft || fsOps.createDraft.parent !== row.parent) {
        return null;
      }
      return (
        <ExplorerCreateRow
          key={`__create__:${row.parent}`}
          draft={fsOps.createDraft}
          depth={row.depth}
          onChange={(name) =>
            fsOps.setCreateDraft((prev) => (prev ? { ...prev, name } : prev))
          }
          onCommit={() => void fsOps.commitCreate()}
          onCancel={() => fsOps.setCreateDraft(null)}
        />
      );
    }
    const { entry, depth } = row;
    return (
      <ExplorerFlatEntry
        key={entry.path}
        entry={entry}
        depth={depth}
        isOpen={tree.expanded.has(entry.path)}
        isSelected={fsOps.selectedPaths.has(entry.path)}
        isActive={props.activeFilePath === entry.path}
        isLoading={tree.loadingDirs.has(entry.path)}
        clipboard={fsOps.clipboard}
        renaming={fsOps.renamingPath === entry.path}
        renameValue={fsOps.renameValue}
        onRenameChange={fsOps.setRenameValue}
        onRenameCommit={() => void fsOps.commitRename()}
        onRenameCancel={() => fsOps.setRenamingPath(null)}
        onMouseDown={fsOps.onEntryMouseDown}
        onClick={fsOps.onEntryClick}
        onDoubleClick={fsOps.onEntryDoubleClick}
        onContextMenu={fsOps.onEntryContextMenu}
      />
    );
  };

  return (
    <>
      <div className="workspace-pane__title">
        <span>Explorer</span>
        <div className="workspace-pane__actions">
          <button
            type="button"
            className="icon-quiet"
            title="New File..."
            aria-label="New File"
            onClick={() => void fsOps.beginCreate('file')}
          >
            <IconNewFile size={13} />
          </button>
          <button
            type="button"
            className="icon-quiet"
            title="New Folder..."
            aria-label="New Folder"
            onClick={() => void fsOps.beginCreate('dir')}
          >
            <IconNewFolder size={13} />
          </button>
          <button
            type="button"
            className="icon-quiet"
            title="Refresh Explorer"
            aria-label="Refresh Explorer"
            onClick={props.onRefresh}
          >
            <IconRefresh size={13} />
          </button>
          <button
            type="button"
            className="icon-quiet"
            title="Collapse Folders in Explorer"
            aria-label="Collapse Folders in Explorer"
            onClick={tree.collapseAll}
          >
            <IconCollapseAll size={13} />
          </button>
        </div>
      </div>
      <div
        ref={treeRef}
        className="explorer-tree"
        tabIndex={0}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          fsOps.openRootContextMenu(e.clientX, e.clientY);
        }}
        onKeyDown={fsOps.onTreeKeyDown}
      >
        <button
          type="button"
          className="explorer-row explorer-row--workspace-root"
          title={props.workspaceRoot}
          onClick={() => tree.setWorkspaceRootOpen((v) => !v)}
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            fsOps.openRootContextMenu(e.clientX, e.clientY);
          }}
        >
          <span className="explorer-twist" aria-hidden>
            {tree.workspaceRootOpen ? (
              <IconChevronDown size={12} />
            ) : (
              <IconChevronRight size={12} />
            )}
          </span>
          <span
            className={`explorer-icon explorer-icon--dir${
              tree.workspaceRootOpen ? ' is-open' : ''
            }`}
            aria-hidden
          >
            {tree.workspaceRootOpen ? (
              <IconFolderOpen size={16} />
            ) : (
              <IconFolder size={16} />
            )}
          </span>
          <span className="explorer-label explorer-label--root">
            {workspaceFolderName(props.workspaceRoot)}
          </span>
        </button>
        {tree.workspaceRootOpen ? (
          tree.rootEntries.length === 0 && !fsOps.createDraft ? (
            <p className="workspace-empty">No files</p>
          ) : (
            <ExplorerVirtualTree
              rows={rows}
              scrollTop={scrollTop}
              viewportHeight={viewportHeight}
              renderRow={renderRow}
            />
          )
        ) : null}
      </div>
      <TopBranchSelect
        placement="explorer"
        baseUrl={props.baseUrl}
        token={props.token}
        workspaceRoot={props.workspaceRoot}
        disabled={props.agentBusy}
        onChanged={props.onBranchChanged}
      />
    </>
  );
}
