import { useEffect, useState } from 'react';

import type { ReviewDiffView, RunFileChangesView } from '../protocol';

export type ReviewFindingChip = {
  path: string;
  content: string;
  startLine?: number;
  endLine?: number;
  severity: string;
  category?: string;
};

interface WorkingTreeReviewBarProps {
  review: ReviewDiffView | null;
  findings?: readonly ReviewFindingChip[];
  /** Latest Mitii run edits — enables Undo All / Keep All. */
  runChanges?: RunFileChangesView | null;
  running?: boolean;
  /** Increment to force-expand (command palette / Review CTA). */
  expandSignal?: number;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFinding?: (path: string, line?: number) => void;
  onRunReview: () => void;
  onUndoAll?: () => void;
  onKeepAll?: () => void;
}

function statusLabel(status: string): string {
  const normalized = status.trim() || '?';
  if (normalized.includes('A') || normalized === 'A') return 'Added';
  if (normalized.includes('D')) return 'Deleted';
  if (normalized.includes('R')) return 'Renamed';
  if (normalized.includes('?')) return 'Untracked';
  if (normalized.includes('M') || normalized === 'M') return 'Edited';
  return normalized;
}

function statusTone(status: string): string {
  const normalized = status.trim();
  if (normalized.includes('A') || normalized.includes('?') || normalized === 'A') {
    return 'added';
  }
  if (normalized.includes('D')) return 'deleted';
  return 'edited';
}

function severityTone(severity: string): string {
  const s = severity.toLowerCase();
  if (s === 'critical' || s === 'high') return 'high';
  if (s === 'medium') return 'medium';
  return 'low';
}

/**
 * Flush review strip attached to the top of the composer box (Cursor-style).
 * Review is an action — not a chat mode.
 */
export function WorkingTreeReviewBar({
  review,
  findings = [],
  runChanges = null,
  running = false,
  expandSignal = 0,
  onRefresh,
  onOpenFile,
  onOpenDiff,
  onOpenFinding,
  onRunReview,
  onUndoAll,
  onKeepAll,
}: WorkingTreeReviewBarProps) {
  const files = review?.files ?? [];
  const fileCount = files.length > 0 ? files.length : (runChanges?.files.length ?? 0);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'files' | 'findings'>('files');

  useEffect(() => {
    if (expandSignal > 0) setExpanded(true);
  }, [expandSignal]);

  useEffect(() => {
    if (findings.length > 0) {
      setTab('findings');
      setExpanded(true);
    }
  }, [findings.length]);

  if (fileCount === 0 && findings.length === 0 && !running) {
    return null;
  }

  const canUndoKeep = Boolean(runChanges && runChanges.files.length > 0);
  const listFiles =
    files.length > 0
      ? files.map((f) => ({ path: f.path, status: f.status }))
      : (runChanges?.files ?? []).map((f) => ({
          path: f.path,
          status: f.status,
        }));

  return (
    <div className="wt-review wt-review--attached" aria-label="Working tree review">
      <div className="wt-review__bar">
        <button
          type="button"
          className="wt-review__summary"
          aria-expanded={expanded}
          onClick={() => setExpanded((v) => !v)}
        >
          <span
            className={`wt-review__chevron${expanded ? ' is-open' : ''}`}
            aria-hidden
          >
            ›
          </span>
          <span className="wt-review__count">
            {fileCount} File{fileCount === 1 ? '' : 's'}
          </span>
          {findings.length > 0 ? (
            <span className="wt-review__finding-badge">
              {findings.length} finding{findings.length === 1 ? '' : 's'}
            </span>
          ) : null}
        </button>
        <div className="wt-review__actions">
          <button
            type="button"
            className="wt-review__link"
            disabled={!canUndoKeep || running}
            title={
              canUndoKeep
                ? 'Revert Mitii edits from the latest run'
                : 'Undo All is available after Mitii edits a run'
            }
            onClick={() => onUndoAll?.()}
          >
            Undo All
          </button>
          <button
            type="button"
            className="wt-review__link"
            disabled={!canUndoKeep || running}
            title={
              canUndoKeep
                ? 'Keep Mitii edits and dismiss the change list'
                : 'Keep All is available after Mitii edits a run'
            }
            onClick={() => {
              onKeepAll?.();
              setExpanded(false);
            }}
          >
            Keep All
          </button>
          <button
            type="button"
            className="wt-review__cta"
            disabled={running || fileCount === 0}
            title="Run a structured read-only review — findings open in the editor"
            onClick={onRunReview}
          >
            {running ? 'Reviewing…' : 'Review'}
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="wt-review__panel">
          <div className="wt-review__panel-head">
            <div className="wt-review__tabs">
              <button
                type="button"
                className={`wt-review__tab${tab === 'files' ? ' is-active' : ''}`}
                onClick={() => setTab('files')}
              >
                Files
              </button>
              <button
                type="button"
                className={`wt-review__tab${tab === 'findings' ? ' is-active' : ''}`}
                onClick={() => setTab('findings')}
              >
                Findings{findings.length ? ` (${findings.length})` : ''}
              </button>
            </div>
            <button
              type="button"
              className="wt-review__link"
              onClick={onRefresh}
            >
              Refresh
            </button>
          </div>
          {tab === 'findings' ? (
            findings.length === 0 ? (
              <p className="wt-review__empty">
                No findings yet. Click Review — issues appear on the code line
                in the editor (and in Problems).
              </p>
            ) : (
              <ul className="wt-review__list">
                {findings.map((f, i) => (
                  <li key={`${f.path}:${f.startLine ?? 0}:${i}`} className="wt-review__item">
                    <button
                      type="button"
                      className="wt-review__file"
                      onClick={() => {
                        if (onOpenFinding) onOpenFinding(f.path, f.startLine);
                        else onOpenFile(f.path);
                      }}
                      title={`Open ${f.path}${f.startLine ? `:${f.startLine}` : ''}`}
                    >
                      <span
                        className={`wt-review__sev wt-review__sev--${severityTone(f.severity)}`}
                      >
                        {f.severity}
                      </span>
                      <span className="wt-review__path mono">
                        {f.path}
                        {f.startLine ? `:${f.startLine}` : ''}
                      </span>
                      <span className="wt-review__finding-text">{f.content}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )
          ) : listFiles.length === 0 ? (
            <p className="wt-review__empty">No changed files.</p>
          ) : (
            <ul className="wt-review__list">
              {listFiles.map((file) => {
                const deleted = String(file.status).includes('D');
                return (
                  <li key={file.path} className="wt-review__item">
                    <button
                      type="button"
                      className="wt-review__file"
                      onClick={() => onOpenDiff(file.path)}
                      title={`Open diff for ${file.path}`}
                    >
                      <span
                        className={`wt-review__status wt-review__status--${statusTone(String(file.status))}`}
                      >
                        {statusLabel(String(file.status))}
                      </span>
                      <span className="wt-review__path mono">{file.path}</span>
                    </button>
                    <button
                      type="button"
                      className="wt-review__link"
                      disabled={deleted}
                      onClick={() => onOpenFile(file.path)}
                    >
                      Open
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
