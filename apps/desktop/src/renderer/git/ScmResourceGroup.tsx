import type { MouseEvent as ReactMouseEvent } from 'react';

import type { GitWorkingTreeFile } from '../../shared/git/workingTree.js';
import { gitStatusKind } from '../explorer/DiffView.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconPlus,
} from '../shell/ActivityIcons.js';
import { fileDir, fileLeaf } from './scmPathUtils.js';
import type { ScmGroupKey } from './scmTypes.js';

export interface ScmGroupActions {
  primaryTitle: string;
  primarySymbol: '+' | '−';
  onPrimary: (paths: string[]) => void;
  onPrimaryAll?: () => void;
  dangerTitle?: string;
  onDanger?: (paths: string[]) => void;
}

interface ScmResourceGroupProps {
  groupKey: ScmGroupKey;
  title: string;
  files: GitWorkingTreeFile[];
  open: boolean;
  onToggle: () => void;
  actions: ScmGroupActions;
  disabled: boolean;
  activePath: string | null;
  selectedPaths: ReadonlySet<string>;
  pathsForAction: (path: string, files: GitWorkingTreeFile[]) => string[];
  onSelect: (
    group: ScmGroupKey,
    files: GitWorkingTreeFile[],
    path: string,
    e: ReactMouseEvent,
  ) => void;
  onContextMenu: (
    e: ReactMouseEvent,
    group: ScmGroupKey,
    files: GitWorkingTreeFile[],
    path: string,
  ) => void;
  onOpenDiff: (path: string) => void | Promise<void>;
  onOpenFile: (path: string) => void | Promise<void>;
}

export function ScmResourceGroup(props: ScmResourceGroupProps) {
  const { groupKey: key, title, files, open, actions, disabled } = props;

  return (
    <section className="scm-group">
      <header className="scm-group__header">
        <button
          type="button"
          className="scm-group__twistie"
          onClick={props.onToggle}
          aria-expanded={open}
        >
          {open ? (
            <IconChevronDown size={14} />
          ) : (
            <IconChevronRight size={14} />
          )}
          <span className="scm-group__title">{title}</span>
          <span className="scm-group__count">{files.length}</span>
        </button>
        {files.length > 0 && actions.onPrimaryAll ? (
          <button
            type="button"
            className="scm-icon-btn"
            disabled={disabled}
            title={`${actions.primaryTitle} all`}
            aria-label={`${actions.primaryTitle} all`}
            onClick={actions.onPrimaryAll}
          >
            {actions.primarySymbol === '+' ? (
              <IconPlus size={14} />
            ) : (
              <span className="scm-symbol">−</span>
            )}
          </button>
        ) : null}
      </header>
      {open ? (
        files.length === 0 ? (
          <p className="scm-empty">No {title.toLowerCase()}</p>
        ) : (
          <ul className="scm-resource-list">
            {files.map((file) => {
              const dir = fileDir(file.path);
              const active = props.activePath === `diff:${file.path}`;
              const selected = props.selectedPaths.has(file.path);
              const multiSelected = selected && props.selectedPaths.size > 1;
              return (
                <li
                  key={`${file.group}:${file.path}`}
                  className={`scm-resource scm-resource--${gitStatusKind(file.status)}${
                    active ? ' is-active' : ''
                  }${selected ? ' is-selected' : ''}`}
                  onContextMenu={(e) =>
                    props.onContextMenu(e, key, files, file.path)
                  }
                >
                  <button
                    type="button"
                    className="scm-resource__main"
                    onClick={(e) => {
                      const multi = e.metaKey || e.ctrlKey || e.shiftKey;
                      props.onSelect(key, files, file.path, e);
                      if (!multi) void props.onOpenDiff(file.path);
                    }}
                    onDoubleClick={() => void props.onOpenFile(file.path)}
                    title={
                      file.renameFrom
                        ? `${file.renameFrom} → ${file.path}`
                        : file.path
                    }
                  >
                    <span className="scm-resource__name">
                      {fileLeaf(file.path)}
                    </span>
                    {dir ? (
                      <span className="scm-resource__path">{dir}</span>
                    ) : null}
                    {file.renameFrom ? (
                      <span
                        className="scm-resource__rename"
                        title={file.renameFrom}
                      >
                        ← {fileLeaf(file.renameFrom)}
                      </span>
                    ) : null}
                  </button>
                  <div className="scm-resource__actions">
                    <button
                      type="button"
                      className="scm-icon-btn"
                      disabled={disabled}
                      title={
                        multiSelected
                          ? `${actions.primaryTitle} selected`
                          : actions.primaryTitle
                      }
                      aria-label={`${actions.primaryTitle} ${file.path}`}
                      onClick={() =>
                        actions.onPrimary(props.pathsForAction(file.path, files))
                      }
                    >
                      {actions.primarySymbol === '+' ? (
                        <IconPlus size={13} />
                      ) : (
                        <span className="scm-symbol">−</span>
                      )}
                    </button>
                    {actions.onDanger && actions.dangerTitle ? (
                      <button
                        type="button"
                        className="scm-icon-btn scm-icon-btn--danger"
                        disabled={disabled}
                        title={
                          multiSelected
                            ? `${actions.dangerTitle} selected`
                            : actions.dangerTitle
                        }
                        aria-label={`${actions.dangerTitle} ${file.path}`}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          actions.onDanger?.(
                            props.pathsForAction(file.path, files),
                          );
                        }}
                      >
                        ×
                      </button>
                    ) : null}
                  </div>
                  <span
                    className={`scm-resource__decor scm-resource__decor--${gitStatusKind(file.status)}`}
                    title={file.status}
                  >
                    {file.status.trim().slice(0, 1) ||
                      (file.group === 'untracked' ? 'U' : 'M')}
                  </span>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
