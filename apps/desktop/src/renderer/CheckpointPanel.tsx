import type { CheckpointItemView } from './api.js';

interface CheckpointPanelProps {
  checkpoints: CheckpointItemView[];
  busy?: boolean;
  note?: string | null;
  onRestore: (id: string) => void | Promise<void>;
  onDelete: (id: string) => void | Promise<void>;
  onClear: () => void | Promise<void>;
}

export function CheckpointPanel({
  checkpoints,
  busy,
  note,
  onRestore,
  onDelete,
  onClear,
}: CheckpointPanelProps) {
  if (checkpoints.length === 0) {
    return (
      <section className="context-side-panel">
        <h3 className="panel-title">Checkpoints</h3>
        <p className="panel-empty">
          No checkpoints yet. Labels appear after successful agent runs.
        </p>
        {note ? <p className="field-help">{note}</p> : null}
      </section>
    );
  }

  return (
    <section className="context-side-panel">
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
      {note ? <p className="field-help">{note}</p> : null}
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
