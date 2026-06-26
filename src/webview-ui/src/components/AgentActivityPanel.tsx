import type { AgentActivityEntry } from '../../../vscode/webview/messages';

interface AgentActivityPanelProps {
  entries: AgentActivityEntry[];
  loading: boolean;
}

const KIND_LABEL: Record<AgentActivityEntry['kind'], string> = {
  context: 'Context',
  read: 'Read',
  budget: 'Budget',
  apply: 'Apply',
  info: 'Info',
  approval: 'Approval',
  error: 'Error',
};

export function AgentActivityPanel({ entries, loading }: AgentActivityPanelProps) {
  if (entries.length === 0 && !loading) return null;

  return (
    <div className="agent-activity">
      <div className="agent-activity__header">
        <span>Agent activity</span>
        {loading && <span className="agent-activity__pulse">Running…</span>}
      </div>
      <ol className="agent-activity__list">
        {entries.map((entry) => (
          <li key={entry.id} className={`agent-activity__item agent-activity__item--${entry.kind}`}>
            <span className="agent-activity__kind">{KIND_LABEL[entry.kind]}</span>
            <span className="agent-activity__message">{entry.message}</span>
            {entry.detail && (
              <pre className="agent-activity__detail">{entry.detail}</pre>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
