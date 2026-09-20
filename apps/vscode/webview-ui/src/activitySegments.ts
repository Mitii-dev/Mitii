import type { ActivityEventPayload } from './protocol';

export type TurnSegment =
  | { id: string; kind: 'text'; text: string; at: number }
  | { id: string; kind: 'activity'; event: ActivityEventPayload };

/** Tool titles switch from "Running X" (started) to plain "X" (completed). */
export function activityMergeKey(event: {
  kind: string;
  title: string;
}): string {
  if (event.kind === 'tool') {
    return `tool:${event.title.replace(/^Running\s+/, '')}`;
  }
  return `${event.kind}:${event.title}`;
}

/**
 * Only fold an in-flight row into its completion (running → done/failed).
 *
 * Do **not** collapse successive calls of the same tool (e.g. many
 * apply_patch turns) into one chat row — Gemini/tool-only batches used to
 * show a single "Apply patch" while 10+ files changed on disk.
 */
export function shouldReplaceActivity(
  existing: { kind: string; title: string; status?: string },
  incoming: { kind: string; title: string; status?: string },
): boolean {
  if (activityMergeKey(existing) !== activityMergeKey(incoming)) {
    return false;
  }
  return existing.status === 'running';
}

const MAX_SEGMENTS = 160;

/**
 * Appends an activity event to the trailing run of activity segments.
 * Thinking deltas merge into one growing "Thought" row. Tool/stage rows only
 * update while status is `running` (started → completed); a new same-named
 * tool after completion becomes its own row.
 */
export function appendActivitySegment(
  segments: TurnSegment[],
  incoming: ActivityEventPayload,
  reasoningPreviewMaxChars: number,
  uid: (prefix: string) => string = defaultUid,
): TurnSegment[] {
  const last = segments[segments.length - 1];

  if (
    incoming.kind === 'thinking' &&
    last?.kind === 'activity' &&
    last.event.kind === 'thinking'
  ) {
    const detail = `${last.event.detail ?? ''}${incoming.detail ?? ''}`.slice(
      -reasoningPreviewMaxChars,
    );
    const next = [...segments];
    next[next.length - 1] = {
      ...last,
      event: { ...last.event, ...incoming, detail, at: last.event.at },
    };
    return next;
  }

  if (incoming.kind !== 'thinking') {
    let start = segments.length;
    while (start > 0 && segments[start - 1]!.kind === 'activity') start -= 1;

    for (let i = segments.length - 1; i >= start; i -= 1) {
      const seg = segments[i]!;
      if (
        seg.kind !== 'activity' ||
        seg.event.kind === 'thinking' ||
        !shouldReplaceActivity(seg.event, incoming)
      ) {
        continue;
      }
      const next = [...segments];
      next[i] = {
        ...seg,
        event: {
          ...seg.event,
          ...incoming,
          detail: incoming.detail ?? seg.event.detail,
          at: seg.event.at,
        },
      };
      return next;
    }
  }

  const next: TurnSegment[] = [
    ...segments,
    { id: uid('seg'), kind: 'activity', event: incoming },
  ];
  return next.length > MAX_SEGMENTS ? next.slice(-MAX_SEGMENTS) : next;
}

function defaultUid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}
