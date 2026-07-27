import type { CheckpointItemView } from '../protocol';

interface CheckpointPanelProps {
  checkpoints: CheckpointItemView[];
  onRestore: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function CheckpointPanel({
  checkpoints,
  onRestore,
  onDelete,
  onClear,
}: CheckpointPanelProps) {
  if (checkpoints.length === 0) {
    return (
      <div className="side-panel">
        <h3 className="panel-title">Checkpoints</h3>
        <p className="panel-empty">No checkpoints yet.</p>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <div className="panel-header-row">
        <h3 className="panel-title">Checkpoints</h3>
        <button
          type="button"
          className="btn ghost"
          onClick={onClear}
          title="Delete all checkpoints"
        >
          Clear all
        </button>
      </div>
      <ul className="checkpoint-list">
        {checkpoints.map((cp) => (
          <li key={cp.id} className="checkpoint-item">
            <div className="checkpoint-item__meta">
              <span className="checkpoint-item__label">{cp.label}</span>
              <span className="mono">
                {new Date(cp.createdAt).toLocaleString()}
              </span>
            </div>
            <div className="checkpoint-item__actions">
              <button
                type="button"
                className="btn ghost"
                onClick={() => onRestore(cp.id)}
                title="Restore checkpoint"
              >
                Restore
              </button>
              <button
                type="button"
                className="memory-item__delete"
                onClick={() => onDelete(cp.id)}
                aria-label={`Delete checkpoint ${cp.label}`}
                title="Delete checkpoint"
              >
                ×
              </button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
