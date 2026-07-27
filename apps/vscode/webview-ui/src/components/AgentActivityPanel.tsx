import type { ActivityEventPayload } from '../protocol';

const ACTIVITY_LIMIT = 10;

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

  const visible = events.slice(-ACTIVITY_LIMIT);
  const hiddenCount = Math.max(0, events.length - visible.length);

  return (
    <div className="activity">
      {onToggle ? (
        <button type="button" className="activity-toggle" onClick={onToggle}>
          {open ? 'Hide activity' : 'Show activity'} · {events.length}
        </button>
      ) : null}
      {open || !onToggle ? (
        <ol className="activity-list">
          {hiddenCount > 0 ? (
            <li className="activity-item info">
              <span className="activity-dot" />
              <div className="activity-body">
                <div className="activity-detail">
                  +{hiddenCount} earlier step{hiddenCount === 1 ? '' : 's'}
                </div>
              </div>
            </li>
          ) : null}
          {visible.map((item) => (
            <li key={item.id} className={`activity-item ${item.kind}`}>
              <span className="activity-dot" />
              <div className="activity-body">
                <div className="activity-title">{item.title}</div>
                {item.detail ? (
                  <div className="activity-detail">{item.detail}</div>
                ) : null}
              </div>
            </li>
          ))}
          {loading && events.length === 0 ? (
            <li className="activity-item info">
              <span className="activity-dot" />
              <div className="activity-body">
                <div className="activity-title">Working…</div>
              </div>
            </li>
          ) : null}
        </ol>
      ) : null}
    </div>
  );
}
