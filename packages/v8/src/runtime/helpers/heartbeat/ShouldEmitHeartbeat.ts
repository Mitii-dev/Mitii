/** Heartbeat on long mutate/research runs — default soft interval. */
export const DEFAULT_HEARTBEAT_INTERVAL_MS = 45_000;

export function shouldEmitHeartbeat(params: {
  lastHeartbeatAtMs?: number;
  nowMs: number;
  intervalMs?: number;
  runActive: boolean;
}): boolean {
  if (!params.runActive) return false;
  const interval = params.intervalMs ?? DEFAULT_HEARTBEAT_INTERVAL_MS;
  if (params.lastHeartbeatAtMs == null) return true;
  return params.nowMs - params.lastHeartbeatAtMs >= interval;
}
