import type { AgentActivityEntry } from '../../../vscode/webview/messages';

interface AgentActivityPanelProps {
  entries: AgentActivityEntry[];
  loading: boolean;
  waitingForApproval?: boolean;
}

const KIND_LABEL: Record<AgentActivityEntry['kind'], string> = {
  context: 'Context',
  read: 'Read',
  budget: 'Budget',
  apply: 'Write',
  info: 'Info',
  approval: 'Approval',
  error: 'Error',
  tool: 'Tool',
};

export function AgentActivityPanel({ entries, loading, waitingForApproval = false }: AgentActivityPanelProps) {
  const visible = entries.slice(-8);
  const latest = entries[entries.length - 1];
  const statusLabel = loading
    ? 'Working through steps'
    : waitingForApproval
      ? 'Waiting for your approval'
      : 'Activity complete';

  if (entries.length === 0 && !loading && !waitingForApproval) return null;

  return (
    <section className="assistant-thinking" aria-label="Agent activity">
      <p className="message-working assistant-thinking__status">
        <span
          className={`message-working__pulse ${
            waitingForApproval && !loading ? 'message-working__pulse--waiting' : ''
          }`}
          aria-hidden="true"
        />
        <span>{latest?.message ?? statusLabel}</span>
      </p>
      <ol className="assistant-thinking__list">
        {visible.map((entry, index) => {
          const isLatest = index === visible.length - 1;
          return (
            <li
              key={entry.id}
              className={`assistant-thinking__item assistant-thinking__item--${entry.kind} ${
                isLatest && loading ? 'assistant-thinking__item--active' : ''
              }`}
            >
              <span className="assistant-thinking__kind">{KIND_LABEL[entry.kind]}</span>
              <span className="assistant-thinking__message">{entry.message}</span>
              {entry.detail && (
                <span className="assistant-thinking__detail">{summarizeDetail(entry.detail)}</span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function summarizeDetail(detail: string): string {
  const firstLine = detail.split('\n').find(Boolean) ?? detail;
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}...` : firstLine;
}
