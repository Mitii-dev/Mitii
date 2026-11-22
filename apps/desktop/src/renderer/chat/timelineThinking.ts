import type { DesktopActivityItem } from '../../shared/activity.js';

/** Stable id for the live placeholder so the row does not remount every paint. */
export const LIVE_THINKING_ID = 'act_live_thinking';

export function formatThinkingDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function isLiveThinking(item: DesktopActivityItem | undefined): boolean {
  if (!item || item.kind !== 'thinking') return false;
  return item.status !== 'done' && item.status !== 'failed';
}

function isRunningTool(item: DesktopActivityItem | undefined): boolean {
  return item?.kind === 'tool' && item.status === 'running';
}

/**
 * Keep a visible Brainstorming row while the model is working and no tool is
 * currently running. Empty streams otherwise show nothing until the first event.
 */
export function timelineRowsForPaint(
  items: DesktopActivityItem[],
  streaming: boolean,
): DesktopActivityItem[] {
  const rows = items.filter((item) => item.id !== LIVE_THINKING_ID);
  if (!streaming) return rows;
  const last = rows[rows.length - 1];
  if (isLiveThinking(last) || isRunningTool(last)) return rows;
  return [
    ...rows,
    {
      id: LIVE_THINKING_ID,
      at: last?.at ?? 0,
      kind: 'thinking',
      title: 'Thinking',
      status: 'running',
    },
  ];
}

/** Last non-empty lines of a thinking detail for the live / expanded preview. */
export function thinkingPreview(detail: string | undefined, maxLines = 14): string {
  return (detail ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-maxLines)
    .join('\n');
}

/**
 * Label for a thinking segment in the chronological timeline.
 * Live last row → “Brainstorming”; settled → “Thought for Xs”.
 */
export function thinkingSegmentLabel(
  item: DesktopActivityItem,
  index: number,
  items: DesktopActivityItem[],
  streaming: boolean,
  groupEndAt?: number,
): string {
  const isLast = index === items.length - 1;
  const live =
    streaming &&
    isLast &&
    (item.status === 'running' ||
      (item.status !== 'done' && item.status !== 'failed'));
  if (live) return 'Brainstorming';

  const next = items[index + 1];
  const endAt =
    item.endedAt ??
    (next ? next.at : undefined) ??
    groupEndAt ??
    item.at;
  return `Thought for ${formatThinkingDuration(Math.max(0, endAt - item.at))}`;
}
