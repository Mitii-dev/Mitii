import type { CheckpointItemView } from '../protocol';

interface CheckpointPanelProps {
  checkpoints: CheckpointItemView[];
  onRestore: (id: string) => void;
}

export function CheckpointPanel({
  checkpoints,
  onRestore,
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
      <h3 className="panel-title">Checkpoints</h3>
      <ul className="checkpoint-list">
        {checkpoints.map((cp) => (
          <li key={cp.id} className="checkpoint-item">
            <div className="checkpoint-item__meta">
              <span className="checkpoint-item__label">{cp.label}</span>
              <span className="mono">
                {new Date(cp.createdAt).toLocaleString()}
              </span>
            </div>
            <button
              type="button"
              className="btn ghost"
              onClick={() => onRestore(cp.id)}
            >
              Restore
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
