type Props = {
  reviewComplete: boolean;
  canUndoKeep: boolean;
  canExpandReview: boolean;
  running: boolean;
  onUndoAll?: () => void;
  onKeepAll?: () => void;
  onShowChanges: () => void;
  onCollapse: () => void;
  onSelectFilesTab: () => void;
};

/** Review-block actions: Undo All · Keep All · Review. */
export function ReviewBarActions({
  reviewComplete,
  canUndoKeep,
  canExpandReview,
  running,
  onUndoAll,
  onKeepAll,
  onShowChanges,
  onCollapse,
  onSelectFilesTab,
}: Props) {
  if (reviewComplete) {
    return <div className="wt-review__actions" />;
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
    </div>
  );
}
