type Props = {
  reviewComplete: boolean;
  canUndoKeep: boolean;
  canFix: boolean;
  canExpandReview: boolean;
  showCodeReview: boolean;
  codeReviewButtonLabel: string;
  canRunCodeReview: boolean;
  running: boolean;
  hasFindings: boolean;
  onUndoAll?: () => void;
  onKeepAll?: () => void;
  onDismissFindings?: () => void;
  onFixAllFindings?: () => void;
  onShowChanges: () => void;
  onRunCodeReview?: () => void;
  onCollapse: () => void;
  onSelectFilesTab: () => void;
};

/** Action cluster: Undo/Keep (chat) · Review (chat) · Code Review (git). */
export function ReviewBarActions({
  reviewComplete,
  canUndoKeep,
  canFix,
  canExpandReview,
  showCodeReview,
  codeReviewButtonLabel,
  canRunCodeReview,
  running,
  hasFindings,
  onUndoAll,
  onKeepAll,
  onDismissFindings,
  onFixAllFindings,
  onShowChanges,
  onRunCodeReview,
  onCollapse,
  onSelectFilesTab,
}: Props) {
  if (reviewComplete) {
    return (
      <div className="wt-review__actions">
        {onDismissFindings ? (
          <button
            type="button"
            className="wt-review__link"
            title="Clear the completed review strip"
            onClick={() => {
              onDismissFindings();
              onCollapse();
            }}
          >
            Clear
          </button>
        ) : null}
      </div>
    );
  }

  return (
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
          onCollapse();
        }}
      >
        Keep All
      </button>
      {hasFindings && onDismissFindings ? (
        <button
          type="button"
          className="wt-review__link"
          disabled={running}
          title="Clear review findings from the editor and this bar"
          onClick={() => {
            onDismissFindings();
            onCollapse();
          }}
        >
          Dismiss
        </button>
      ) : null}
      {canFix ? (
        <button
          type="button"
          className="wt-review__cta wt-review__cta--fix"
          disabled={running}
          title="Fix all open findings in Agent mode (localized edits)"
          onClick={() => onFixAllFindings?.()}
        >
          Fix all
        </button>
      ) : null}
      <button
        type="button"
        className="wt-review__cta"
        disabled={!canExpandReview}
        title="Show Mitii file changes from this chat"
        onClick={() => {
          onSelectFilesTab();
          onShowChanges();
        }}
      >
        Review
      </button>
      {showCodeReview && onRunCodeReview ? (
        <button
          type="button"
          className="wt-review__cta wt-review__cta--code"
          disabled={!canRunCodeReview}
          title="LLM code review of all git working-tree changes"
          onClick={onRunCodeReview}
        >
          {running ? 'Reviewing…' : codeReviewButtonLabel}
        </button>
      ) : null}
    </div>
  );
}
