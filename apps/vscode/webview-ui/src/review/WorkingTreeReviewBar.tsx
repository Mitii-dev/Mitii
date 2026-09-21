import { useEffect, useMemo, useState } from 'react';

import type { ReviewDiffView, RunFileChangesView } from '../protocol';
import { ReviewBarActions } from './ReviewBarActions';
import { ReviewFilesPanel } from './ReviewFilesPanel';
import { ReviewFindingsPanel } from './ReviewFindingsPanel';
import type { ReviewFindingChip } from './reviewFindingTypes';
import {
  chatFilesFromRunChanges,
  gitFilesFromReview,
  resolveReviewBarScope,
} from './reviewBarModel';

export type { ReviewFindingChip } from './reviewFindingTypes';

interface WorkingTreeReviewBarProps {
  review: ReviewDiffView | null;
  findings?: readonly ReviewFindingChip[];
  /** Latest Mitii run edits — Files list + Undo All / Keep All. */
  runChanges?: RunFileChangesView | null;
  running?: boolean;
  /** Increment to force-expand (command palette / Review CTA). */
  expandSignal?: number;
  onRefresh: () => void;
  onOpenFile: (path: string) => void;
  onOpenDiff: (path: string) => void;
  onOpenFinding?: (path: string, line?: number) => void;
  /** Expand the bar and show this-chat file changes (no LLM). */
  onShowChanges: () => void;
  /** LLM code review of the full git working tree. */
  onRunCodeReview?: () => void;
  showCodeReview?: boolean;
  onUndoAll?: () => void;
  onKeepAll?: () => void;
  onDismissFindings?: () => void;
  onFixFinding?: (index: number) => void;
  onFixAllFindings?: () => void;
}

/**
 * Flush review strip attached to the top of the composer box.
 * Review = this-chat diffs. Code Review = full git + findings (feature-gated).
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
  onShowChanges,
  onRunCodeReview,
  showCodeReview = false,
  onUndoAll,
  onKeepAll,
  onDismissFindings,
  onFixFinding,
  onFixAllFindings,
}: WorkingTreeReviewBarProps) {
  const scope = useMemo(
    () =>
      resolveReviewBarScope({
        gitFiles: gitFilesFromReview(review?.files),
        chatFiles: chatFilesFromRunChanges(runChanges?.files),
        findingsCount: findings.length,
        showCodeReview,
        running,
      }),
    [review?.files, runChanges?.files, findings.length, showCodeReview, running],
  );

  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<'files' | 'findings'>('files');

  const openFindings = findings.filter((f) => f.status !== 'fixed');
  const fixedFindings = findings.filter((f) => f.status === 'fixed');
  const reviewComplete =
    scope.showFindingsUi &&
    findings.length > 0 &&
    openFindings.length === 0 &&
    fixedFindings.length > 0;
  const hasOpenFindings = scope.showFindingsUi && openFindings.length > 0;

  useEffect(() => {
    if (expandSignal > 0) setExpanded(true);
  }, [expandSignal]);

  useEffect(() => {
    if (scope.showFindingsUi && findings.length > 0) {
      setTab('findings');
      setExpanded(true);
    }
  }, [findings.length, scope.showFindingsUi]);

  useEffect(() => {
    if (reviewComplete) setExpanded(false);
  }, [reviewComplete]);

  if (!scope.visible) return null;

  const canUndoKeep =
    !reviewComplete && Boolean(runChanges && runChanges.files.length > 0);
  const canFix =
    hasOpenFindings && !running && Boolean(onFixAllFindings) && !reviewComplete;

  return (
    <div
      className={`wt-review wt-review--attached${reviewComplete ? ' wt-review--done' : ''}`}
      aria-label="Working tree review"
    >
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
          <span className="wt-review__count">{scope.summaryLabel}</span>
          {reviewComplete ? (
            <span
              className="wt-review__done-tick"
              title="All review findings fixed"
              aria-label="Review complete"
            >
              ✓
            </span>
          ) : null}
          {hasOpenFindings ? (
            <span className="wt-review__finding-badge">
              {openFindings.length} open
            </span>
          ) : null}
          {reviewComplete ? (
            <span className="wt-review__done-badge">Done</span>
          ) : fixedFindings.length > 0 && scope.showFindingsUi ? (
            <span className="wt-review__fixed-badge">
              {fixedFindings.length} fixed
            </span>
          ) : null}
        </button>
        <ReviewBarActions
          reviewComplete={reviewComplete}
          canUndoKeep={canUndoKeep}
          canFix={canFix}
          canExpandReview={scope.canExpandReview}
          showCodeReview={scope.showFindingsUi}
          codeReviewButtonLabel={scope.codeReviewButtonLabel}
          canRunCodeReview={scope.canRunCodeReview}
          running={running}
          hasFindings={scope.showFindingsUi && findings.length > 0}
          onUndoAll={onUndoAll}
          onKeepAll={onKeepAll}
          onDismissFindings={
            scope.showFindingsUi ? onDismissFindings : undefined
          }
          onFixAllFindings={scope.showFindingsUi ? onFixAllFindings : undefined}
          onShowChanges={() => {
            setExpanded(true);
            onShowChanges();
          }}
          onRunCodeReview={onRunCodeReview}
          onCollapse={() => setExpanded(false)}
          onSelectFilesTab={() => setTab('files')}
        />
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
              {scope.showFindingsUi ? (
                <button
                  type="button"
                  className={`wt-review__tab${tab === 'findings' ? ' is-active' : ''}`}
                  onClick={() => setTab('findings')}
                >
                  Findings{findings.length ? ` (${findings.length})` : ''}
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="wt-review__link"
              onClick={onRefresh}
            >
              Refresh
            </button>
          </div>
          {tab === 'findings' && scope.showFindingsUi ? (
            <ReviewFindingsPanel
              findings={findings}
              running={running}
              onOpenFinding={onOpenFinding}
              onOpenFile={onOpenFile}
              onFixFinding={onFixFinding}
            />
          ) : (
            <ReviewFilesPanel
              files={scope.chatFiles}
              onOpenDiff={onOpenDiff}
              onOpenFile={onOpenFile}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
