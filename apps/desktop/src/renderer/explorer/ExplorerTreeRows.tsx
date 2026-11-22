import { useEffect, useRef, type MouseEvent, type ReactNode } from 'react';

import {
  IconChevronDown,
  IconChevronRight,
  IconEllipsis,
  IconFile,
  IconFolder,
  IconFolderOpen,
} from '../shell/ActivityIcons.js';
import type {
  ClipboardState,
  CreateDraft,
  FlatRow,
  TreeEntry,
} from './explorerTypes.js';
import {
  EXPLORER_OVERSCAN,
  EXPLORER_ROW_HEIGHT,
} from './flattenVisible.js';

function useFocusSelect() {
  const ref = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return ref;
}

function KindIcon({ kind }: { kind: 'file' | 'dir' }) {
  return kind === 'dir' ? <IconFolder size={16} /> : <IconFile size={16} />;
}

export function ExplorerCreateRow({
  draft,
  depth,
  onChange,
  onCommit,
  onCancel,
}: {
  draft: CreateDraft;
  depth: number;
  onChange: (name: string) => void;
  onCommit: () => void;
  onCancel: () => void;
}) {
  const inputRef = useFocusSelect();
  return (
    <div
      className="explorer-row explorer-row--rename"
      style={{ paddingLeft: 4 + depth * 8 }}
    >
      <span className="explorer-twist" aria-hidden />
      <span className="explorer-icon" aria-hidden>
        <KindIcon kind={draft.kind} />
      </span>
      <input
        ref={inputRef}
        className="explorer-rename"
        value={draft.name}
        aria-label={draft.kind === 'file' ? 'New file name' : 'New folder name'}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            onCommit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            onCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export interface ExplorerFlatEntryProps {
  entry: TreeEntry;
  depth: number;
  isOpen: boolean;
  isSelected: boolean;
  isActive: boolean;
  isLoading: boolean;
  clipboard: ClipboardState | null;
  renaming: boolean;
  renameValue: string;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
  onMouseDown: (entry: TreeEntry, e: MouseEvent<HTMLButtonElement>) => void;
  onClick: (entry: TreeEntry, e: MouseEvent<HTMLButtonElement>) => void;
  onDoubleClick: (entry: TreeEntry, e: MouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (entry: TreeEntry, e: MouseEvent<HTMLButtonElement>) => void;
}

function RenameInputRow(props: ExplorerFlatEntryProps) {
  const inputRef = useFocusSelect();
  return (
    <div
      className="explorer-row explorer-row--rename"
      style={{
        paddingLeft: 4 + props.depth * 8,
        height: EXPLORER_ROW_HEIGHT,
      }}
    >
      <span className="explorer-twist" aria-hidden />
      <span className="explorer-icon" aria-hidden>
        <KindIcon kind={props.entry.kind} />
      </span>
      <input
        ref={inputRef}
        className="explorer-rename"
        value={props.renameValue}
        onChange={(e) => props.onRenameChange(e.target.value)}
        onBlur={props.onRenameCommit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            props.onRenameCommit();
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            props.onRenameCancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
      />
    </div>
  );
}

export function ExplorerFlatEntry(props: ExplorerFlatEntryProps) {
  const { entry, depth, isOpen, isSelected, isActive, clipboard } = props;
  if (props.renaming) return <RenameInputRow {...props} />;

  const isCut =
    clipboard?.mode === 'cut' && clipboard.paths.includes(entry.path);

  return (
    <button
      type="button"
      className={`explorer-row${isSelected || isActive ? ' is-active' : ''}${
        isSelected ? ' is-selected' : ''
      }${isCut ? ' is-cut' : ''}`}
      style={{ paddingLeft: 4 + depth * 8, height: EXPLORER_ROW_HEIGHT }}
      onMouseDown={(e) => props.onMouseDown(entry, e)}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey) {
          e.preventDefault();
          return;
        }
        props.onClick(entry, e);
      }}
      onDoubleClick={(e) => props.onDoubleClick(entry, e)}
      onContextMenu={(e) => props.onContextMenu(entry, e)}
      title={entry.path}
    >
      <span className="explorer-twist" aria-hidden>
        {entry.kind === 'dir' ? (
          props.isLoading ? (
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
  );
}

export function ExplorerVirtualTree({
  rows,
  scrollTop,
  viewportHeight,
  renderRow,
}: {
  rows: FlatRow[];
  scrollTop: number;
  viewportHeight: number;
  renderRow: (row: FlatRow) => ReactNode;
}) {
  const total = rows.length;
  const start = Math.max(
    0,
    Math.floor(scrollTop / EXPLORER_ROW_HEIGHT) - EXPLORER_OVERSCAN,
  );
  const visibleCount =
    Math.ceil(viewportHeight / EXPLORER_ROW_HEIGHT) + EXPLORER_OVERSCAN * 2;
  const end = Math.min(total, start + visibleCount);
  return (
    <div
      className="explorer-tree__virtual"
      style={{
        height: Math.max(total, 1) * EXPLORER_ROW_HEIGHT,
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: start * EXPLORER_ROW_HEIGHT,
          left: 0,
          right: 0,
        }}
      >
        {rows.slice(start, end).map(renderRow)}
      </div>
    </div>
  );
}
