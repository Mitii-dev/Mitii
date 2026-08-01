import { useMemo, useState } from 'react';

import type { RunFileChangesView } from '../protocol';
import { IconButton } from './IconButton';
import { IconReview } from './Icons';

interface FileChangesCardProps {
  changes: RunFileChangesView;
  compact?: boolean;
  onOpenFile: (path: string) => void;
  onReviewFile: (path: string) => void;
  onUndo: () => void;
  onReviewAll: () => void;
  onDismiss?: () => void;
}

function splitPath(path: string): { dir: string; name: string } {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return { dir: '', name: path };
  return { dir: path.slice(0, idx + 1), name: path.slice(idx + 1) };
}

function folderForPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  if (parts.length <= 1) return '(root)';
  return parts.slice(0, Math.min(2, parts.length - 1)).join('/');
}

function statusLabel(
  status: RunFileChangesView['files'][number]['status'],
): string {
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

function statusClass(status: RunFileChangesView['files'][number]['status']): string {
  switch (status) {
    case 'A':
      return 'added';
    case 'D':
      return 'deleted';
    case 'M':
      return 'edited';
    default:
      return 'changed';
  }
}

export function FileChangesBar({
  changes,
  onExpand,
  onUndo,
  onReviewAll,
}: {
  changes: RunFileChangesView;
  onExpand: () => void;
  onUndo: () => void;
  onReviewAll: () => void;
}) {
  const n = changes.files.length;
  return (
    <div className="file-changes-bar" role="status">
      <button type="button" className="file-changes-bar__summary" onClick={onExpand}>
        <span className="file-changes-bar__icon" aria-hidden>
          +
        </span>
        <span>
          {n} file{n === 1 ? '' : 's'} changed
        </span>
        <span className="file-changes-bar__stats">
          <span className="diff-add">+{changes.totalAdditions}</span>
          <span className="diff-del">−{changes.totalDeletions}</span>
        </span>
      </button>
      <div className="file-changes-bar__actions">
        <button
          type="button"
          className="btn ghost"
          onClick={onUndo}
          title="Revert Mitii's edits from this run"
        >
          Undo
        </button>
        <button type="button" className="btn" onClick={onReviewAll}>
          Review
        </button>
      </div>
    </div>
  );
}

export function FileChangesCard({
  changes,
  compact = false,
  onOpenFile,
  onReviewFile,
  onUndo,
  onReviewAll,
  onDismiss,
}: FileChangesCardProps) {
  const [expanded, setExpanded] = useState(!compact);
  const [openDiffPath, setOpenDiffPath] = useState<string | null>(null);
  const previewCount = 3;
  const visible = useMemo(
    () => (expanded ? changes.files : changes.files.slice(0, previewCount)),
    [changes.files, expanded],
  );
  const hidden = Math.max(0, changes.files.length - visible.length);
  const n = changes.files.length;
  const statusSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of changes.files) {
      const label = statusLabel(file.status);
      counts.set(label, (counts.get(label) ?? 0) + 1);
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([label, count]) => ({ label, count }));
  }, [changes.files]);
  const folderSummary = useMemo(() => {
    const counts = new Map<string, number>();
    for (const file of changes.files) {
      const folder = folderForPath(file.path);
      counts.set(folder, (counts.get(folder) ?? 0) + 1);
    }
    const ranked = [...counts.entries()].sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    );
    const visibleFolders = ranked
      .slice(0, 3)
      .map(([folder, count]) => `${folder} (${count})`);
    const hiddenFolders = ranked.length - visibleFolders.length;
    return `${visibleFolders.join(', ')}${hiddenFolders > 0 ? `, +${hiddenFolders} more` : ''}`;
  }, [changes.files]);

  return (
    <section className="file-changes-card" aria-label="File changes">
      {changes.leftUntouchedPreDirty ? (
        <p className="file-changes-card__note">
          There were already other staged/modified files in the repo, so I left
          those untouched.
        </p>
      ) : null}
      <header className="file-changes-card__header">
        <div className="file-changes-card__title-row">
          <span className="file-changes-card__badge" aria-hidden>
            +
          </span>
          <div>
            <div className="file-changes-card__title">
              Files changed
            </div>
            <div className="file-changes-card__stats">
              <span>
                {n} file{n === 1 ? '' : 's'}
              </span>
              <span className="diff-add">+{changes.totalAdditions}</span>
              <span className="diff-del">−{changes.totalDeletions}</span>
            </div>
          </div>
        </div>
        <div className="file-changes-card__actions">
          <button
            type="button"
            className="btn ghost"
            onClick={onUndo}
            title="Revert Mitii's edits from this run"
          >
            Undo
          </button>
          <button type="button" className="btn" onClick={onReviewAll}>
            Review
          </button>
          {onDismiss ? (
            <IconButton label="Dismiss" variant="ghost" onClick={onDismiss}>
              ×
            </IconButton>
          ) : null}
        </div>
      </header>
      {statusSummary.length > 0 ? (
        <div className="file-changes-card__status-strip" aria-label="Change types">
          {statusSummary.map(({ label, count }) => (
            <span
              key={label}
              className={`file-changes-card__status-chip file-changes-card__status-chip--${label.toLowerCase()}`}
            >
              <span>{label}</span>
              <strong>{count}</strong>
            </span>
          ))}
        </div>
      ) : null}
      <div className="file-changes-card__summary">
        <div>
          <span className="file-changes-card__summary-label">Folders</span>
          <span>{folderSummary}</span>
        </div>
        {changes.leftUntouchedPreDirty ? (
          <div>
            <span className="file-changes-card__summary-label">Untouched</span>
            <span>
              {changes.leftUntouchedPreDirty} pre-existing dirty file
              {changes.leftUntouchedPreDirty === 1 ? '' : 's'}
            </span>
          </div>
        ) : null}
      </div>
      <ul className="file-changes-card__list">
        {visible.map((file) => {
          const { dir, name } = splitPath(file.path);
          const showDiff = openDiffPath === file.path;
          const label = statusLabel(file.status);
          const tone = statusClass(file.status);
          return (
            <li key={file.path} className="file-changes-card__item">
              <div className="file-changes-card__file-row">
                <span
                  className={`file-changes-card__file-status file-changes-card__file-status--${tone}`}
                >
                  {label}
                </span>
                <button
                  type="button"
                  className="file-changes-card__path"
                  onClick={() => onOpenFile(file.path)}
                  title={`Open ${file.path}`}
                >
                  {dir ? <span className="file-changes-card__dir">{dir}</span> : null}
                  <span className="file-changes-card__name">{name}</span>
                </button>
                <button
                  type="button"
                  className="file-changes-card__file-stats"
                  onClick={() =>
                    setOpenDiffPath(showDiff ? null : file.path)
                  }
                  title={showDiff ? 'Hide diff preview' : 'Show diff preview'}
                >
                  <span className="diff-add">+{file.additions}</span>
                  <span className="diff-del">−{file.deletions}</span>
                </button>
                <IconButton
                  label={`Open diff for ${file.path}`}
                  variant="ghost"
                  onClick={() => onReviewFile(file.path)}
                >
                  <IconReview />
                </IconButton>
              </div>
              {showDiff && file.patchPreview ? (
                <div className="file-changes-card__diff-wrap">
                  <pre className="file-changes-card__diff">
                    <code>{file.patchPreview}</code>
                  </pre>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() => onReviewFile(file.path)}
                  >
                    Open full diff
                  </button>
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      {hidden > 0 ? (
        <button
          type="button"
          className="file-changes-card__more"
          onClick={() => setExpanded(true)}
        >
          Show {hidden} more file{hidden === 1 ? '' : 's'} ▾
        </button>
      ) : null}
      {expanded && changes.files.length > previewCount ? (
        <button
          type="button"
          className="file-changes-card__more"
          onClick={() => setExpanded(false)}
        >
          Show less ▴
        </button>
      ) : null}
    </section>
  );
}
