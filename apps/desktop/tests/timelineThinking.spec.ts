import { describe, expect, it } from 'vitest';

import {
  LIVE_THINKING_ID,
  formatThinkingDuration,
  thinkingPreview,
  thinkingSegmentLabel,
  timelineRowsForPaint,
} from '../src/renderer/chat/timelineThinking.js';
import { appendActivity, type DesktopActivityItem } from '../src/shared/activity.js';

describe('timelineThinking helpers', () => {
  it('formats durations in seconds and minutes', () => {
    expect(formatThinkingDuration(400)).toBe('1s');
    expect(formatThinkingDuration(3500)).toBe('4s');
    expect(formatThinkingDuration(90_000)).toBe('2m');
  });

  it('keeps the last preview lines', () => {
    const detail = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    const preview = thinkingPreview(detail, 3);
    expect(preview).toBe('line 18\nline 19\nline 20');
  });

  it('labels live vs settled thinking segments in chronological order', () => {
    const thinking1: DesktopActivityItem = {
      id: 't1',
      at: 1000,
      kind: 'thinking',
      title: 'Thinking',
      detail: 'plan A',
      status: 'done',
      endedAt: 4000,
    };
    const tool: DesktopActivityItem = {
      id: 'tool1',
      at: 4000,
      kind: 'tool',
      title: 'Running read_file',
      status: 'done',
    };
    const thinking2: DesktopActivityItem = {
      id: 't2',
      at: 5000,
      kind: 'thinking',
      title: 'Thinking',
      detail: 'plan B',
      status: 'running',
    };
    const items = [thinking1, tool, thinking2];

    expect(thinkingSegmentLabel(thinking1, 0, items, true)).toBe('Thought for 3s');
    expect(thinkingSegmentLabel(thinking2, 2, items, true)).toBe('Brainstorming');
    expect(thinkingSegmentLabel(thinking2, 2, items, false, 8000)).toBe(
      'Thought for 3s',
    );
  });

  it('keeps Brainstorming visible while streaming with no activity yet', () => {
    const rows = timelineRowsForPaint([], true);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(LIVE_THINKING_ID);
    expect(thinkingSegmentLabel(rows[0]!, 0, rows, true)).toBe('Brainstorming');
  });

  it('does not add a placeholder while a tool is running', () => {
    const tool: DesktopActivityItem = {
      id: 'tool1',
      at: 4000,
      kind: 'tool',
      title: 'Running read_file',
      status: 'running',
    };
    expect(timelineRowsForPaint([tool], true)).toEqual([tool]);
  });
});

describe('appendActivity chronological thinking segments', () => {
  it('keeps thinking → tool → thinking as separate timeline rows', () => {
    let list: DesktopActivityItem[] = [];
    list = appendActivity(list, {
      id: 't1',
      at: 1000,
      kind: 'thinking',
      title: 'Thinking',
      detail: 'first',
      status: 'running',
    });
    list = appendActivity(list, {
      id: 'tool1',
      at: 3000,
      kind: 'tool',
      title: 'Running read_file',
      status: 'running',
    });
    list = appendActivity(list, {
      id: 't2',
      at: 4000,
      kind: 'thinking',
      title: 'Thinking',
      detail: 'second',
      status: 'running',
    });

    expect(list.map((row) => row.kind)).toEqual(['thinking', 'tool', 'thinking']);
    expect(list[0]?.status).toBe('done');
    expect(list[0]?.endedAt).toBe(3000);
    expect(list[2]?.status).toBe('running');
    expect(list[2]?.detail).toBe('second');
  });
});
