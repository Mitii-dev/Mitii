import { describe, expect, it, vi } from 'vitest';

import { createStreamPaintScheduler } from '../src/renderer/chat/streamPaintScheduler.js';
import type { DesktopActivityItem } from '../src/shared/activity.js';

function item(id: string, title: string): DesktopActivityItem {
  return {
    id,
    at: 1,
    kind: 'info',
    title,
    status: 'done',
  };
}

describe('createStreamPaintScheduler', () => {
  it('coalesces updates within the window and paints the latest snapshot', () => {
    const paints: Array<{ text: string; titles: string[] }> = [];
    const timers: Array<{ fn: () => void; ms: number }> = [];

    const scheduler = createStreamPaintScheduler({
      coalesceMs: 1000,
      paint: (snapshot) => {
        paints.push({
          text: snapshot.text,
          titles: snapshot.activity.map((a) => a.title),
        });
      },
      schedule: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => {
        timers.length = 0;
      },
    });

    scheduler.update({
      text: 'a',
      activity: [item('1', 'first')],
      streaming: true,
    });
    scheduler.update({
      text: 'ab',
      activity: [item('1', 'first'), item('2', 'second')],
      streaming: true,
    });

    expect(paints).toHaveLength(0);
    expect(timers).toHaveLength(1);
    expect(timers[0]?.ms).toBe(1000);

    timers[0]!.fn();

    expect(paints).toHaveLength(1);
    expect(paints[0]?.text).toBe('ab');
    expect(paints[0]?.titles).toEqual(['first', 'second']);
  });

  it('force flushes immediately with the latest snapshot', () => {
    const paint = vi.fn();
    const timers: Array<{ fn: () => void }> = [];

    const scheduler = createStreamPaintScheduler({
      coalesceMs: 1000,
      paint,
      schedule: (fn) => {
        timers.push({ fn });
        return 1 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: vi.fn(),
    });

    scheduler.update({
      text: 'partial',
      activity: [item('1', 'thinking')],
      streaming: true,
    });
    scheduler.force({
      text: 'final',
      activity: [item('1', 'thinking'), item('2', 'tool')],
      streaming: false,
    });

    expect(paint).toHaveBeenCalledTimes(1);
    expect(paint.mock.calls[0]?.[0]).toMatchObject({
      text: 'final',
      streaming: false,
    });
    expect(paint.mock.calls[0]?.[0]?.activity.map((a) => a.title)).toEqual([
      'thinking',
      'tool',
    ]);
  });

  it('schedules a new window after a flush', () => {
    const paint = vi.fn();
    const timers: Array<{ fn: () => void; ms: number }> = [];

    const scheduler = createStreamPaintScheduler({
      coalesceMs: 1000,
      paint,
      schedule: (fn, ms) => {
        timers.push({ fn, ms });
        return timers.length as unknown as ReturnType<typeof setTimeout>;
      },
      cancel: () => {
        timers.length = 0;
      },
    });

    scheduler.update({
      text: 'one',
      activity: [],
      streaming: true,
    });
    timers[0]!.fn();
    expect(paint).toHaveBeenCalledTimes(1);

    scheduler.update({
      text: 'two',
      activity: [],
      streaming: true,
    });
    expect(timers).toHaveLength(1);
    timers[0]!.fn();
    expect(paint).toHaveBeenCalledTimes(2);
    expect(paint.mock.calls[1]?.[0]?.text).toBe('two');
  });

  it('dispose cancels without painting', () => {
    const paint = vi.fn();
    const cancel = vi.fn();

    const scheduler = createStreamPaintScheduler({
      coalesceMs: 1000,
      paint,
      schedule: (fn) => {
        void fn;
        return 42 as unknown as ReturnType<typeof setTimeout>;
      },
      cancel,
    });

    scheduler.update({
      text: 'x',
      activity: [],
      streaming: true,
    });
    scheduler.dispose();

    expect(cancel).toHaveBeenCalledWith(42);
    expect(paint).not.toHaveBeenCalled();
  });
});
