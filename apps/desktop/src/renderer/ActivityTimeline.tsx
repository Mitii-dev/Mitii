import type { DesktopActivityItem } from '../shared/activity.js';

interface ActivityTimelineProps {
  items: DesktopActivityItem[];
  streaming?: boolean;
}

const BRANCHES = ['arc', 'elbow', 'reach', 'twig'] as const;

function thinkingDurationLabel(item: DesktopActivityItem): string {
  const seconds = Math.max(1, Math.round((Date.now() - item.at) / 1000));
  return `Thought for ${seconds}s`;
}

function rowState(
  item: DesktopActivityItem,
  running: boolean,
): 'muted' | 'active' | 'done' | 'warn' {
  if (item.status === 'failed' || item.kind === 'warning' || item.kind === 'suspended') {
    return 'warn';
  }
  if (running) return 'active';
  if (item.status === 'done' || item.status === 'completed') return 'done';
  return 'muted';
}

export function ActivityTimeline({ items, streaming }: ActivityTimelineProps) {
  if (items.length === 0) return null;

  const rows = items;

  return (
    <ol
      className={`timeline${streaming ? ' timeline--streaming' : ''}`}
      aria-label="Agent activity"
    >
      {rows.map((item, index) => {
        const isLast = index === rows.length - 1;
        const running = Boolean(
          item.status === 'running' ||
            (streaming &&
              isLast &&
              item.status !== 'done' &&
              item.status !== 'failed'),
        );
        const state = rowState(item, running);
        const branch = BRANCHES[index % BRANCHES.length];
        const isThinking = item.kind === 'thinking';
        const thinkingActive = isThinking && running;

        return (
          <li
            key={item.id}
            className={[
              'timeline__row',
              `timeline__row--${state}`,
              `timeline__row--kind-${item.kind}`,
              `timeline__row--branch-${branch}`,
              item.kind === 'tool' ? 'timeline__row--tool' : '',
              thinkingActive ? 'timeline__row--thinking-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span
              className={`timeline__marker${running ? ' timeline__marker--spin' : ''}`}
              aria-hidden
            />
            <span
              className={`timeline__row-text${
                state === 'muted' ? ' timeline__row-text--muted' : ''
              }`}
            >
              {isThinking ? (
                <>
                  <span className="timeline__thinking-label">
                    {thinkingActive
                      ? 'Brainstorming'
                      : item.status === 'done'
                        ? thinkingDurationLabel(item)
                        : item.title}
                  </span>
                  {item.detail ? (
                    <span className="timeline__thinking-preview">
                      {item.detail}
                    </span>
                  ) : null}
                </>
              ) : (
                <>
                  <span className="timeline__row-title">{item.title}</span>
                  {item.paths && item.paths.length > 0 ? (
                    <span className="timeline__paths">
                      {item.paths.map((p) => (
                        <span key={p} className="timeline__path-chip">
                          {p}
                        </span>
                      ))}
                    </span>
                  ) : null}
                  {item.detail && !(item.paths && item.paths.length > 0) ? (
                    <span className="timeline__row-detail">{item.detail}</span>
                  ) : null}
                </>
              )}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
