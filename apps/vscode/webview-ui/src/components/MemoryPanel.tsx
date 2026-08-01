import { useState } from 'react';
import type { MemoryItemView } from '../protocol';

interface MemoryPanelProps {
  memories: MemoryItemView[];
  onAdd: (text: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

export function MemoryPanel({
  memories,
  onAdd,
  onDelete,
  onClear,
}: MemoryPanelProps) {
  const [draft, setDraft] = useState('');

  const submit = () => {
    const text = draft.trim();
    if (!text) return;
    onAdd(text);
    setDraft('');
  };

  return (
    <div className="side-panel">
      <div className="panel-header-row">
        <h3 className="panel-title">Memory</h3>
        {memories.length > 0 ? (
          <button
            type="button"
            className="btn ghost"
            onClick={onClear}
            title="Clear all memories"
          >
            Clear all
          </button>
        ) : null}
      </div>

      <div className="memory-compose">
        <textarea
          className="memory-compose__input"
          rows={3}
          value={draft}
          placeholder="Add a workspace preference or observation…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button
          type="button"
          className="btn"
          disabled={!draft.trim()}
          onClick={submit}
          title="Save memory (⌘/Ctrl+Enter)"
        >
          Add
        </button>
      </div>

      {memories.length === 0 ? (
        <p className="panel-empty">No observations yet.</p>
      ) : (
        <ul className="memory-list">
          {memories.map((m) => (
            <li key={m.id} className="memory-item">
              <div className="memory-item__meta">
                <span className="mono">
                  {new Date(m.createdAt).toLocaleString()}
                </span>
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
      )}
    </div>
  );
}
