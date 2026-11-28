/**
 * S13-CHECKPOINT — embed TaskList handoffs in gate checkpoint payload.
 */

export function attachHandoffsToCheckpointPayload(input: {
  payload?: Record<string, unknown>;
  store: {
    getSlice: <T>(key: string) => T | undefined;
  };
}): Record<string, unknown> {
  const handoffs = input.store.getSlice<unknown[]>("taskHandoffs");
  const taskList = input.store.getSlice<unknown>("taskList");
  const base = { ...(input.payload ?? {}) };
  if (Array.isArray(handoffs) && handoffs.length > 0) {
    base.taskHandoffs = handoffs.slice(-8);
  }
  if (taskList != null) {
    base.taskList = taskList;
  }
  if (base.taskHandoffs || base.taskList) {
    base.handoffCheckpoint = true;
  }
  return base;
}
