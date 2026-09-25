/**
 * Expandable post-run changes panel above the composer.
 * Mirrors the in-chat FileChangesCard expand pattern.
 * Code Review lives in the Git panel — not duplicated here.
 */

import { useState } from 'react';

import type {
  DesktopFileChangeEntry,
  DesktopFileChanges,
} from '../../shared/fileChanges.js';
import type { ReviewFinding } from '../../shared/reviewFindings.js';
import {
  IconChevronDown,
  IconChevronRight,
  IconClose,
  IconDiff,
  IconEye,
  IconFile,
  IconGit,
  IconUndo,
  IconWrench,
} from '../ActivityIcons.js';
import { DiffView } from '../explorer/DiffView.js';

export type ReviewFindingChip = ReviewFinding & {
  status?: 'open' | 'fixed';
};

export interface RunFileChangesSummary {
  runId: string;
  fileCount: number;
  totalAdditions?: number;
  totalDeletions?: number;
}

export interface WorkingTreeReviewBarProps {
  fileChangeCount: number;
  findings: readonly ReviewFindingChip[];
  files?: readonly DesktopFileChangeEntry[];
  running?: boolean;
  runChanges?: RunFileChangesSummary | null;
  totalAdditions?: number;
  totalDeletions?: number;
  onShowChanges: () => void;
  onOpenFile?: (path: string) => void;
  onUndoChanges?: () => void;
  onFixAll?: () => void;
  onDismiss?: () => void;
}

function statusLabel(status: DesktopFileChangeEntry['status']): string {
  switch (status) {
    case 'A':
      return 'Added';
    case 'D':
      return 'Deleted';
    case 'M':
      return 'Edited';
    default:
      return 'Changed';
  }
}

function shortPath(path: string): string {
  const parts = path.replace(/\\/g, '/').split('/');
  if (parts.length <= 2) return path;
  return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function WorkingTreeReviewBar({
  fileChangeCount,
  findings,
  files = [],
  running = false,
  runChanges = null,
  totalAdditions = 0,
  totalDeletions = 0,
  onShowChanges,
  onOpenFile,
  onUndoChanges,
  onFixAll,
  onDismiss,
}: WorkingTreeReviewBarProps) {
  const [expanded, setExpanded] = useState(false);
  const [openDiff, setOpenDiff] = useState<string | null>(null);

  const openFindings = findings.filter((f) => f.status !== 'fixed');
  const findingsCount = openFindings.length;
  const hasChanges = fileChangeCount > 0 || Boolean(runChanges?.fileCount);
  const changeCount = files.length || runChanges?.fileCount || fileChangeCount;
  const additions = runChanges?.totalAdditions ?? totalAdditions;
  const deletions = runChanges?.totalDeletions ?? totalDeletions;
  const canExpand = files.length > 0;

  if (!hasChanges && findingsCount === 0) return null;

  return (
    <section
      className={`composer-changes${expanded ? ' is-expanded' : ''}`}
      aria-label="Run changes"
    >
      <header className="composer-changes__head">
        <button
          type="button"
          className="composer-changes__summary"
          aria-expanded={canExpand ? expanded : undefined}
          disabled={!canExpand}
          onClick={() => {
            if (!canExpand) return;
            setExpanded((v) => !v);
          }}
        >
          <span className="composer-changes__chevron" aria-hidden>
            {canExpand ? (
              expanded ? (
                <IconChevronDown size={12} />
              ) : (
                <IconChevronRight size={12} />
              )
            ) : (
              <IconGit size={13} />
            )}
          </span>
          <span className="composer-changes__icon" aria-hidden>
            <IconDiff size={14} />
          </span>
          {hasChanges ? (
            <>
              <strong className="composer-changes__label">
                {changeCount} file{changeCount === 1 ? '' : 's'} changed
              </strong>
              {additions > 0 || deletions > 0 ? (
                <span className="composer-changes__stats" aria-hidden>
                  {additions > 0 ? (
                    <span className="diff-add">+{additions}</span>
                  ) : null}
                  {deletions > 0 ? (
                    <span className="diff-del">−{deletions}</span>
                  ) : null}
                </span>
              ) : null}
            </>
          ) : (
            <strong className="composer-changes__label">Review findings</strong>
          )}
          {findingsCount > 0 ? (
            <span className="composer-changes__findings">
              {findingsCount} finding{findingsCount === 1 ? '' : 's'}
            </span>
          ) : null}
        </button>

        <div className="composer-changes__actions">
          {hasChanges ? (
            <button
              type="button"
              className="composer-changes__btn composer-changes__btn--primary"
              disabled={running}
              title="View in Git"
              onClick={onShowChanges}
            >
              <IconEye size={13} />
              <span>View</span>
            </button>
          ) : null}
          {hasChanges && onUndoChanges ? (
            <button
              type="button"
              className="composer-changes__btn"
              disabled={running}
              title="Undo changes"
              onClick={onUndoChanges}
            >
              <IconUndo size={13} />
              <span>Undo</span>
            </button>
          ) : null}
          {findingsCount > 0 && onFixAll ? (
            <button
              type="button"
              className="composer-changes__btn composer-changes__btn--accent"
              disabled={running}
              title="Fix all findings"
              onClick={onFixAll}
            >
              <IconWrench size={13} />
              <span>Fix all</span>
            </button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              className="composer-changes__dismiss"
              disabled={running}
              aria-label="Dismiss"
              title="Dismiss"
              onClick={onDismiss}
            >
              <IconClose size={12} />
            </button>
          ) : null}
        </div>
      </header>

      {expanded && canExpand ? (
        <ul className="composer-changes__list">
          {files.map((file) => {
            const showDiff = openDiff === file.path;
            return (
              <li key={file.path} className="composer-changes__item">
                <div className="composer-changes__row">
                  <span
                    className={`composer-changes__status composer-changes__status--${
                      file.status === '?' ? 'U' : file.status
                    }`}
                    title={statusLabel(file.status)}
                  >
                    {file.status === 'A'
                      ? 'A'
                      : file.status === 'D'
                        ? 'D'
                        : file.status === 'M'
                          ? 'M'
                          : '?'}
                  </span>
                  <IconFile size={13} className="composer-changes__file-icon" />
                  <button
                    type="button"
                    className="composer-changes__path"
                    title={file.path}
                    onClick={() => {
                      if (onOpenFile) onOpenFile(file.path);
                      else onShowChanges();
                    }}
                  >
                    {shortPath(file.path)}
                  </button>
                  <button
                    type="button"
                    className="composer-changes__file-stats"
                    title={showDiff ? 'Hide diff' : 'Show diff'}
                    onClick={() =>
                      setOpenDiff(showDiff ? null : file.path)
                    }
                  >
                    <span className="diff-add">+{file.additions}</span>
                    <span className="diff-del">−{file.deletions}</span>
                  </button>
                </div>
                {showDiff && file.patchPreview ? (
                  <div className="composer-changes__diff">
                    <DiffView content={file.patchPreview} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** Convenience: build props from a DesktopFileChanges object. */
export function filesFromChanges(
  changes: DesktopFileChanges | null | undefined,
): readonly DesktopFileChangeEntry[] {
  return changes?.files ?? [];
}
