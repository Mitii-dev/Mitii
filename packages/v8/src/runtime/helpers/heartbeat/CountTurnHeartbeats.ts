import {
  DEFAULT_HEARTBEAT_INTERVAL_MS,
  shouldEmitHeartbeat,
} from "./ShouldEmitHeartbeat";

/** Count heartbeats over a wall-clock span for turn-loop usage sketches. */
export function countTurnHeartbeats(params: {
  startedAtMs: number;
  nowMs: number;
  intervalMs?: number;
  runActive?: boolean;
}): number {
  if (params.runActive === false) return 0;
  const interval = params.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (interval <= 0) return 0;

  let count = 0;
  let lastAt: number | undefined;
  for (
    let t = params.startedAtMs;
    t <= params.nowMs;
    t += Math.max(1, Math.floor(interval / 2))
  ) {
    if (
      shouldEmitHeartbeat({
        lastHeartbeatAtMs: lastAt,
        nowMs: t,
        intervalMs: interval,
        runActive: true,
      })
    ) {
      count += 1;
      lastAt = t;
    }
  }
  return count;
}
