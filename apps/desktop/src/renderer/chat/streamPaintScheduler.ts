/**
 * Coalesce rapid stream paints into ~1s windows so fast models don't flicker.
 * Keeps the latest snapshot; flushes on a timer or immediately via force().
 */

import type { DesktopActivityItem } from '../../shared/activity.js';

export interface StreamPaintSnapshot {
  text: string;
  activity: DesktopActivityItem[];
  streaming: boolean;
}

export interface StreamPaintScheduler {
  /** Queue a paint; schedules a flush if none is pending. */
  update(snapshot: StreamPaintSnapshot): void;
  /** Paint immediately (result / error / end). Optional snapshot overrides pending. */
  force(snapshot?: StreamPaintSnapshot): void;
  /** Cancel any pending timer without painting. */
  dispose(): void;
}

export interface StreamPaintSchedulerOptions {
  paint: (snapshot: StreamPaintSnapshot) => void;
  /** Coalesce window in ms (default 1000). */
  coalesceMs?: number;
  schedule?: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  cancel?: (id: ReturnType<typeof setTimeout>) => void;
}

export function createStreamPaintScheduler(
  options: StreamPaintSchedulerOptions,
): StreamPaintScheduler {
  const coalesceMs = options.coalesceMs ?? 1000;
  const schedule = options.schedule ?? ((fn, ms) => setTimeout(fn, ms));
  const cancel = options.cancel ?? ((id) => clearTimeout(id));

  let pending: StreamPaintSnapshot | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer != null) {
      cancel(timer);
      timer = null;
    }
    if (!pending) return;
    const snapshot = pending;
    pending = null;
    options.paint(snapshot);
  };

  return {
    update(snapshot) {
      pending = snapshot;
      if (timer == null) {
        timer = schedule(flush, coalesceMs);
      }
    },
    force(snapshot) {
      if (snapshot) pending = snapshot;
      flush();
    },
    dispose() {
      if (timer != null) {
        cancel(timer);
        timer = null;
      }
      pending = null;
    },
  };
}
