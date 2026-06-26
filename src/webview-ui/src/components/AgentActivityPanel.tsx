import { useState } from 'react';
import type { AgentActivityEntry } from '../../../vscode/webview/messages';
import { IconChevronDown } from './Icons';

interface AgentActivityPanelProps {
  entries: AgentActivityEntry[];
  loading: boolean;
  compact?: boolean;
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

export function AgentActivityPanel({ entries, loading, compact }: AgentActivityPanelProps) {
  const [open, setOpen] = useState(false);
  const visible = compact ? entries.slice(-8) : entries;
  const latest = entries[entries.length - 1];

  if (entries.length === 0 && !loading) return null;

  if (compact) {
    return (
      <section className="agent-timeline" aria-label="Agent activity">
        <div className="agent-timeline__header">
          <span className={`agent-timeline__status ${loading ? 'agent-timeline__status--running' : ''}`} />
          <div className="agent-timeline__title">
            <span>{loading ? 'Working through steps' : 'Activity complete'}</span>
            {latest && <strong>{latest.message}</strong>}
          </div>
          <span className="agent-timeline__count">{entries.length}</span>
        </div>
        <ol className="agent-timeline__list">
          {visible.map((entry, index) => {
            const isLatest = index === visible.length - 1;
            return (
              <li
                key={entry.id}
                className={`agent-timeline__item agent-timeline__item--${entry.kind} ${
                  isLatest && loading ? 'agent-timeline__item--active' : ''
                }`}
              >
                <span className="agent-timeline__rail" aria-hidden="true" />
                <div className="agent-timeline__body">
                  <div className="agent-timeline__row">
                    <span className="agent-timeline__kind">{KIND_LABEL[entry.kind]}</span>
                    <span className="agent-timeline__message">{entry.message}</span>
                  </div>
                  {entry.detail && (
                    <pre className="agent-timeline__detail">
                      {isLatest ? entry.detail : summarizeDetail(entry.detail)}
                    </pre>
                  )}
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    );
  }

  return (
    <details className="activity-drawer" open={open} onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="activity-drawer__summary">
        <span>
          {loading && latest
            ? `${KIND_LABEL[latest.kind]}: ${latest.message}`
            : `Activity${loading ? ' · running' : ''}`}
        </span>
        <span className="activity-drawer__count">{entries.length}</span>
        <IconChevronDown className="activity-drawer__chevron" width={14} height={14} />
      </summary>
      <ol className="agent-activity__list">
        {visible.map((entry) => (
          <li key={entry.id} className={`agent-activity__item agent-activity__item--${entry.kind}`}>
            <span className="agent-activity__kind">{KIND_LABEL[entry.kind]}</span>
            <span className="agent-activity__message">{entry.message}</span>
            {entry.detail && !compact && <pre className="agent-activity__detail">{entry.detail}</pre>}
          </li>
        ))}
      </ol>
    </details>
  );
}

function summarizeDetail(detail: string): string {
  const firstLine = detail.split('\n').find(Boolean) ?? detail;
  return firstLine.length > 140 ? `${firstLine.slice(0, 140)}...` : firstLine;
}
