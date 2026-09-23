/**
 * WIRING.md — App.tsx
 * - Prefer ComposerReviewStrip (wraps this). If mounting directly:
 *   import { WorkingTreeReviewBar } from './WorkingTreeReviewBar.js'
 * - Place above the composer input when run file changes or review findings exist.
 */

import type { ReviewFinding } from '../shared/reviewFindings.js';

export type ReviewFindingChip = ReviewFinding & {
  status?: 'open' | 'fixed';
};

export interface RunFileChangesSummary {
  runId: string;
  fileCount: number;
}

export interface WorkingTreeReviewBarProps {
  fileChangeCount: number;
  findings: readonly ReviewFindingChip[];
  running?: boolean;
  codeReviewEnabled?: boolean;
  runChanges?: RunFileChangesSummary | null;
  onShowChanges: () => void;
  onRunCodeReview?: () => void;
  onUndoChanges?: () => void;
  onFixAll?: () => void;
  onDismiss?: () => void;
}

export function WorkingTreeReviewBar({
  fileChangeCount,
  findings,
  running = false,
  codeReviewEnabled = false,
  runChanges = null,
  onShowChanges,
  onRunCodeReview,
  onUndoChanges,
  onFixAll,
  onDismiss,
}: WorkingTreeReviewBarProps) {
  const openFindings = findings.filter((f) => f.status !== 'fixed');
  const findingsCount = openFindings.length;
  const hasChanges = fileChangeCount > 0 || Boolean(runChanges?.fileCount);
  const changeCount = runChanges?.fileCount ?? fileChangeCount;

  if (!hasChanges && findingsCount === 0) return null;

  return (
    <div className="composer-review-strip" aria-label="Composer review">
      <div className="composer-review-strip__summary">
        {hasChanges ? (
          <span>
            {changeCount} file{changeCount === 1 ? '' : 's'} changed
          </span>
        ) : null}
        {findingsCount > 0 ? (
          <span className="composer-review-strip__badge">
            {findingsCount} finding{findingsCount === 1 ? '' : 's'}
          </span>
        ) : null}
      </div>
      <div className="composer-review-strip__actions">
        {hasChanges ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={running}
            onClick={onShowChanges}
          >
            Show changes
          </button>
        ) : null}
        {codeReviewEnabled && onRunCodeReview ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={running}
            onClick={onRunCodeReview}
          >
            Code Review
          </button>
        ) : null}
        {hasChanges && onUndoChanges ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={running}
            onClick={onUndoChanges}
          >
            Undo changes
          </button>
        ) : null}
        {findingsCount > 0 && onFixAll ? (
          <button
            type="button"
            className="btn btn-primary"
            disabled={running}
            onClick={onFixAll}
          >
            Fix all
          </button>
        ) : null}
        {onDismiss ? (
          <button
            type="button"
            className="btn btn-ghost"
            disabled={running}
            onClick={onDismiss}
          >
            Dismiss
          </button>
        ) : null}
      </div>
    </div>
  );
}
