import type { ChatThreadSummary } from '../protocol';

interface HistoryPanelProps {
  threads: ChatThreadSummary[];
  activeThreadId?: string;
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function HistoryPanel({
  threads,
  activeThreadId,
  onOpen,
  onDelete,
  onClear,
}: HistoryPanelProps) {
  if (threads.length === 0) {
    return (
      <div className="panel-view history-panel">
        <div className="empty-state">
          <h2>No history yet</h2>
          <p>Past conversations will appear here.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-view history-panel">
      <div className="panel-header-row">
        <h2>History</h2>
        <div className="row">
          <span className="mono">{threads.length} conversations</span>
          <button
            type="button"
            className="btn ghost"
            onClick={onClear}
            title="Clear all conversations"
          >
            Clear all
          </button>
        </div>
      </div>
      <ul className="history-list">
        {threads.map((thread) => (
          <li
            key={thread.id}
            className={`history-item${activeThreadId === thread.id ? ' history-item--active' : ''}`}
          >
            <button
              type="button"
              className="history-item__open"
              onClick={() => onOpen(thread.id)}
            >
              <span className="history-item__title">{thread.title}</span>
              <span className="history-item__meta">
                {thread.messageCount} msgs · {formatDate(thread.updatedAt)}
              </span>
            </button>
            <button
              type="button"
              className="history-item__delete"
              aria-label={`Delete ${thread.title}`}
              title={`Delete ${thread.title}`}
              onClick={() => onDelete(thread.id)}
            >
              ×
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
