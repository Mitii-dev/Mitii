import type { MemoryItemView } from '../protocol';

interface MemoryPanelProps {
  memories: MemoryItemView[];
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function MemoryPanel({ memories, onDelete, onClear }: MemoryPanelProps) {
  if (memories.length === 0) {
    return (
      <div className="side-panel">
        <h3 className="panel-title">Memory</h3>
        <p className="panel-empty">No observations yet.</p>
      </div>
    );
  }

  return (
    <div className="side-panel">
      <div className="panel-header-row">
        <h3 className="panel-title">Memory</h3>
        <button type="button" className="btn ghost" onClick={onClear} title="Clear all memories">
          Clear all
        </button>
      </div>
      <ul className="memory-list">
        {memories.map((m) => (
          <li key={m.id} className="memory-item">
            <div className="memory-item__meta">
              <span className="mono">{new Date(m.createdAt).toLocaleString()}</span>
              <button
                type="button"
                className="memory-item__delete"
                onClick={() => onDelete(m.id)}
                aria-label="Delete memory"
                title="Delete memory"
              >
                ×
              </button>
            </div>
            <p className="memory-item__text">{m.text}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
