import type { DesktopActivityItem } from '../shared/activity.js';

interface ThinkingBlockProps {
  items: DesktopActivityItem[];
  streaming?: boolean;
  /** When the assistant turn finished (for frozen “Thought for Xs”). */
  endAt?: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function thinkingPreview(detail: string | undefined): string {
  return (detail ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-10)
    .join('\n');
}

/**
 * VS Code–style reasoning UI: live “Brainstorming” with a short preview,
 * then collapses to “Thought for Xs” (preview hidden) when the turn settles.
 * Rendered outside the activity timeline so it does not mix with tools.
 */
export function ThinkingBlock({
  items,
  streaming,
  endAt,
}: ThinkingBlockProps) {
  if (items.length === 0) return null;

  const first = items[0]!;
  const last = items[items.length - 1]!;
  const detail = items
    .map((item) => item.detail ?? '')
    .filter(Boolean)
    .join('');
  const active = Boolean(streaming);
  const preview = active ? thinkingPreview(detail) : '';
  const finishedAt =
    endAt ??
    items
      .map((item) => item.endedAt)
      .filter((value): value is number => typeof value === 'number')
      .at(-1) ??
    last.at;
  const label = active
    ? 'Brainstorming'
    : `Thought for ${formatDuration(Math.max(0, finishedAt - first.at))}`;

  return (
    <div
      className={`thinking-block${active ? ' thinking-block--active' : ''}`}
      aria-label={label}
    >
      <div className="thinking-block__label">{label}</div>
      {preview ? (
        <pre className="thinking-block__preview">{preview}</pre>
      ) : null}
    </div>
  );
}

export function thinkingItemsFromActivity(
  items: DesktopActivityItem[] | undefined,
): DesktopActivityItem[] {
  if (!items?.length) return [];
  return items.filter((item) => item.kind === 'thinking');
}
