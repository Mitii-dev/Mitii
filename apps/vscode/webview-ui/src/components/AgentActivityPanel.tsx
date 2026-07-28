import type { ActivityEventPayload } from '../protocol';

const ACTIVITY_LIMIT = 24;
const THINKING_LINE_LIMIT = 8;
const THINKING_CHAR_LIMIT = 1400;

interface AgentActivityPanelProps {
  events: ActivityEventPayload[];
  open?: boolean;
  onToggle?: () => void;
}

interface AgentThinkingPanelProps {
  events: ActivityEventPayload[];
  loading?: boolean;
}

function getThinkingTail(events: ActivityEventPayload[]): string {
  const text = events
    .filter((item) => item.kind === 'thinking')
    .map((item) => item.detail || item.title)
    .join('\n')
    .trim();

  if (!text) return '';

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-THINKING_LINE_LIMIT);

  return lines.join('\n').slice(-THINKING_CHAR_LIMIT);
}

export function AgentActivityPanel({
  events,
  open = true,
  onToggle,
}: AgentActivityPanelProps) {
  const activityEvents = events.filter((item) => item.kind !== 'thinking');
  const visible = activityEvents.slice(-ACTIVITY_LIMIT);
  const hiddenCount = Math.max(0, activityEvents.length - visible.length);

  if (visible.length === 0) return null;

  return (
    <section className="activity" aria-label="Activity">
      <div className="activity-header">
        <span>Activity</span>
        {onToggle ? (
          <button
            type="button"
            className="activity-toggle"
            onClick={onToggle}
            title={open ? 'Hide activity' : 'Show activity'}
          >
            {open ? 'Hide' : 'Show'} · {activityEvents.length}
          </button>
        ) : null}
      </div>
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
            <li
              key={item.id}
              className={`activity-item activity-item--${item.kind} ${item.kind}`}
            >
              <span className="activity-dot" />
              <div className="activity-body">
                <div className="activity-title">{item.title}</div>
                {item.detail ? (
                  <div className="activity-detail">{item.detail}</div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
      ) : null}
    </section>
  );
}

export function AgentThinkingPanel({
  events,
  loading = false,
}: AgentThinkingPanelProps) {
  const thinkingTail = getThinkingTail(events);

  if (!thinkingTail && !loading) return null;

  return (
    <section
      className={`thinking-panel${!thinkingTail ? ' thinking-panel--idle' : ''}`}
      aria-label={thinkingTail ? 'Latest thinking' : 'Working'}
    >
      <div className="thinking-panel__header">
        <span className="thinking-panel__pulse" />
        <span>{thinkingTail ? 'Thinking' : 'Working'}</span>
      </div>
      {thinkingTail ? (
        <pre className="thinking-panel__body">{thinkingTail}</pre>
      ) : null}
    </section>
  );
}
