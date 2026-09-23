import { describe, expect, it } from 'vitest';

import { appendActivity, type DesktopActivityItem } from '../src/shared/activity.js';

describe('appendActivity thinking close', () => {
  it('marks brainstorming done when a tool follows', () => {
    const thinking: DesktopActivityItem = {
      id: 't1',
      at: 1000,
      kind: 'thinking',
      title: 'Thinking',
      detail: 'Considering architecture…',
      status: 'running',
    };
    const tool: DesktopActivityItem = {
      id: 'tool1',
      at: 4500,
      kind: 'tool',
      title: 'Running read_file',
      status: 'running',
    };
    const next = appendActivity([thinking], tool);
    expect(next).toHaveLength(2);
    expect(next[0]?.kind).toBe('thinking');
    expect(next[0]?.status).toBe('done');
    expect(next[0]?.endedAt).toBe(4500);
    expect(next[1]?.kind).toBe('tool');
  });
});
