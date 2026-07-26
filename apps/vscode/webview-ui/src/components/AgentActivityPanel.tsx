import type { ActivityEventPayload } from '../protocol';

interface AgentActivityPanelProps {
  events: ActivityEventPayload[];
  open?: boolean;
  onToggle?: () => void;
  loading?: boolean;
}

export function AgentActivityPanel({
  events,
  open = true,
  onToggle,
  loading = false,
}: AgentActivityPanelProps) {
  if (events.length === 0 && !loading) return null;

  return (
    <div className="activity">
      {onToggle ? (
        <button type="button" className="activity-toggle" onClick={onToggle}>
          {open ? 'Hide activity' : 'Show activity'} · {events.length}
        </button>
      ) : null}
      {open || !onToggle
        ? events.map((item) => (
            <div key={item.id} className={`activity-item ${item.kind}`}>
              <span className="activity-dot" />
              <div>
                <div className="activity-title">{item.title}</div>
                {item.detail ? (
                  <div className="activity-detail">{item.detail}</div>
                ) : null}
              </div>
            </div>
          ))
        : null}
      {loading && events.length === 0 ? (
        <div className="activity-item info">
          <span className="activity-dot" />
          <div className="activity-title">Working…</div>
        </div>
      ) : null}
    </div>
  );
}
