import { DEFAULT_HEARTBEAT_INTERVAL_MS } from "./ShouldEmitHeartbeat";

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
  const elapsed = params.nowMs - params.startedAtMs;
  if (elapsed < interval) return 0;
  return Math.floor(elapsed / interval);
}
