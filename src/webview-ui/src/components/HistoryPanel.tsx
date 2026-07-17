import type { ChatThreadSummary } from '../../../vscode/webview/messages';
import { IconTokens } from './Icons';

interface HistoryPanelProps {
  threads: ChatThreadSummary[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
  onClear: () => void;
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function HistoryPanel({ threads, onOpen, onDelete, onClear }: HistoryPanelProps) {
  if (threads.length === 0) {
    return (
      <main className="thunder-main history-panel">
        <div className="empty-chat">
          <p className="empty-title">No history yet</p>
          <p className="empty-subtitle">Past conversations will appear here with token usage.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="thunder-main history-panel">
      <div className="history-panel__header">
        <h2>History</h2>
        <div className="history-panel__actions">
          <span className="history-panel__count">{threads.length} conversations</span>
          <button type="button" className="history-panel__clear" onClick={onClear}>
            Clear all
          </button>
        </div>
      </div>
      <div className="history-list">
        {threads.map((thread) => (
          <div
            key={thread.id}
            className="history-item"
          >
            <button type="button" className="history-item__open" onClick={() => onOpen(thread.id)}>
              <div className="history-item__top">
                <span className="history-item__title">{thread.title}</span>
                <span className="history-item__tokens" title="Total tokens used">
                  <IconTokens width={12} height={12} />
                  {formatTokens(thread.tokenTotal)}
                </span>
              </div>
              <span className="history-item__preview">{thread.lastMessage}</span>
              <span className="history-item__meta">
                {thread.messageCount} msgs · {thread.turnCount} turns · {formatDate(thread.updatedAt)}
              </span>
            </button>
            <button
              type="button"
              className="history-item__delete"
              aria-label={`Delete ${thread.title}`}
              title="Delete conversation"
              onClick={() => onDelete(thread.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </main>
  );
}
