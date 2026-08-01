import type { ActivityEventPayload } from '../protocol';

const ACTIVITY_LIMIT = 4;
const THINKING_LINE_LIMIT = 4;
const THINKING_CHAR_LIMIT = 700;

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
}: AgentActivityPanelProps) {
  const activityEvents = events.filter((item) => item.kind !== 'thinking');
  const hasHidden = activityEvents.length > ACTIVITY_LIMIT;
  const visible = activityEvents.slice(
    -(hasHidden ? ACTIVITY_LIMIT - 1 : ACTIVITY_LIMIT),
  );
  const hiddenCount = Math.max(0, activityEvents.length - visible.length);

  if (visible.length === 0) return null;

  return (
    <ul className="activity-list" aria-label="Activity">
      {hiddenCount > 0 ? (
        <li className="activity-item info">
          <span className="activity-text">
            +{hiddenCount} earlier step{hiddenCount === 1 ? '' : 's'}
          </span>
        </li>
      ) : null}
      {visible.map((item) => (
        <li
          key={item.id}
          className={`activity-item activity-item--${item.kind} ${item.kind}`}
        >
          {item.kind === 'tool' ? (
            <span className="activity-prompt" aria-hidden="true">
              $
            </span>
          ) : null}
          <span className="activity-text">
            <span>{item.title}</span>
            {item.detail ? <small>{item.detail}</small> : null}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function AgentThinkingPanel({
  events,
}: AgentThinkingPanelProps) {
  const thinkingTail = getThinkingTail(events);

  if (!thinkingTail) return null;

  return (
    <section
      className="thinking-panel"
      aria-label="Latest thinking"
    >
      <div className="thinking-panel__header">
        <span className="thinking-panel__pulse" />
        <span>Thinking</span>
      </div>
      <pre className="thinking-panel__body">{thinkingTail}</pre>
    </section>
  );
}
