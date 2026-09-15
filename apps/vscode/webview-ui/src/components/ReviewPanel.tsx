import { useEffect, useMemo, useState } from 'react';

import type { ReviewDiffView } from '../protocol';

interface ReviewPanelProps {
  review: ReviewDiffView | null;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  /** Start an LLM review of the working-tree changes (read-only). */
  onRunReview?: () => void;
  running?: boolean;
  compact?: boolean;
}

const DEFAULT_REVIEW_HINT =
  'Review mode is read-only. Run a review below or type a focus (bugs, security, tests). Do not use Agent for review.';

function reviewStatusLabel(status: string): string {
  const normalized = status.trim() || '?';
  if (normalized.includes('A')) return 'Added';
  if (normalized.includes('D')) return 'Deleted';
  if (normalized.includes('R')) return 'Renamed';
  if (normalized.includes('M')) return 'Modified';
  if (normalized.includes('?')) return 'Untracked';
  return normalized;
}

function reviewStatusTone(status: string): string {
  const normalized = status.trim();
  if (normalized.includes('A') || normalized.includes('?')) return 'added';
  if (normalized.includes('D')) return 'deleted';
  return 'modified';
}

export function ReviewPanel({
  review,
  onRefresh,
  onOpenFile,
  onOpenDiff,
  onRunReview,
  running = false,
  compact = false,
}: ReviewPanelProps) {
  const files = review?.files ?? [];
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const activePath = useMemo(() => {
    if (selectedPath && files.some((file) => file.path === selectedPath)) {
      return selectedPath;
    }
    return files[0]?.path ?? null;
  }, [files, selectedPath]);

  useEffect(() => {
    if (!activePath || selectedPath === activePath) return;
    setSelectedPath(activePath);
  }, [activePath, selectedPath]);

  return (
    <section
      className={`review-panel${compact ? ' review-panel--compact' : ''}`}
      aria-label="Review diff"
    >
      <header className="review-panel__header">
        <div>
          <h3 className="review-panel__title">Review working tree</h3>
          <p className="review-panel__subtitle">
            {review?.summary ?? 'Working tree'} · {files.length} file
            {files.length === 1 ? '' : 's'} · read-only findings
          </p>
        </div>
        <div className="review-panel__actions">
          <button type="button" className="btn ghost" onClick={onRefresh}>
            Refresh
          </button>
          {onRunReview ? (
            <button
              type="button"
              className="btn primary"
              disabled={running || files.length === 0}
              onClick={onRunReview}
              title={
                files.length === 0
                  ? 'Make git changes first, then refresh'
                  : 'Run a structured review of these changes'
              }
            >
              {running ? 'Reviewing…' : 'Run review'}
            </button>
          ) : null}
        </div>
      </header>
      <p className="review-panel__hint">{DEFAULT_REVIEW_HINT}</p>
      {files.length === 0 ? (
        <div className="panel-empty">
          <p>
            No working-tree diff. Edit files (or stage changes), click Refresh,
            then Run review.
          </p>
        </div>
      ) : (
        <div className="review-panel__body">
          <ul className="review-file-list" aria-label="Changed files">
            {files.map((file) => {
              const selected = file.path === activePath;
              const deleted = file.status.includes('D');
              const tone = reviewStatusTone(file.status);
              return (
                <li key={file.path} className="review-file">
                  <button
                    type="button"
                    className={`review-file__button${selected ? ' is-selected' : ''}`}
                    onClick={() => {
                      setSelectedPath(file.path);
                      onOpenDiff(file.path);
                    }}
                    title={`Open diff for ${file.path}`}
                  >
                    <span
                      className={`review-file__status review-file__status--${tone}`}
                    >
                      {reviewStatusLabel(file.status)}
                    </span>
                    <span className="review-file__path mono">{file.path}</span>
                  </button>
                  <button
                    type="button"
                    className="review-file__open"
                    disabled={deleted}
                    onClick={() => onOpenFile(file.path)}
                    title={
                      deleted
                        ? 'Deleted file has no working copy'
                        : `Open ${file.path}`
                    }
                  >
                    Open
                  </button>
                </li>
              );
            })}
          </ul>
          {!compact ? (
            <div className="review-panel__preview" aria-label="Diff summary">
              {activePath ? (
                <div className="review-panel__selected mono">{activePath}</div>
              ) : null}
              {review?.patchPreview ? (
                <pre className="review-patch">
                  <code>{review.patchPreview}</code>
                </pre>
              ) : (
                <div className="panel-empty">
                  <p>No patch preview available for this working tree.</p>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
