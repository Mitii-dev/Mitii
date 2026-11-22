export interface CheckpointItemView {
  id: string;
  label: string;
  createdAt: string | number | Date;
  changedPaths?: readonly string[] | undefined;
}

export interface CheckpointPanelProps {
  checkpoints: readonly CheckpointItemView[];
  onRestore: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
  /** Adds a Review action per checkpoint when provided. */
  onReviewChanges?: ((id: string) => void) | undefined;
  /** Disables every control (for example while the host is restoring). */
  busy?: boolean | undefined;
  /** Status line under the header (errors, restore results). */
  note?: string | null | undefined;
  emptyText?: string;
  /** Root class; hosts pick the surrounding panel chrome. */
  className?: string;
}

/** Checkpoint list with restore, review, delete, and clear-all actions. */
export function CheckpointPanel({
  checkpoints,
  onRestore,
  onDelete,
  onClear,
  onReviewChanges,
  busy,
  note,
  emptyText = 'No checkpoints yet.',
  className = 'side-panel',
}: CheckpointPanelProps) {
  const noteEl = note ? <p className="field-help">{note}</p> : null;

  if (checkpoints.length === 0) {
    return (
      <section className={className}>
        <h3 className="panel-title">Checkpoints</h3>
        <p className="panel-empty">{emptyText}</p>
        {noteEl}
      </section>
    );
  }

  return (
    <section className={className}>
      <div className="panel-header-row">
        <h3 className="panel-title">Checkpoints</h3>
        <button
          type="button"
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => void onClear()}
          title="Delete all checkpoints"
        >
          Clear all
        </button>
      </div>
      {noteEl}
      <ul className="checkpoint-list">
        {checkpoints.map((cp) => (
          <li key={cp.id} className="checkpoint-item">
            <div className="checkpoint-item__meta">
              <span className="checkpoint-item__label">{cp.label}</span>
              <span className="mono">
                {new Date(cp.createdAt).toLocaleString()}
              </span>
              {cp.changedPaths && cp.changedPaths.length > 0 ? (
                <span className="mono">
                  {cp.changedPaths.length} file
                  {cp.changedPaths.length === 1 ? '' : 's'}
                </span>
              ) : null}
            </div>
            <div className="checkpoint-item__actions">
              {onReviewChanges ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  disabled={busy}
                  onClick={() => onReviewChanges(cp.id)}
                  title="Review cumulative changes since this checkpoint"
                >
                  Review
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => void onRestore(cp.id)}
                title="Restore checkpoint"
              >
                Restore
              </button>
              <button
                type="button"
                className="memory-item__delete"
                disabled={busy}
                onClick={() => void onDelete(cp.id)}
                aria-label={`Delete checkpoint ${cp.label}`}
                title="Delete checkpoint"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
