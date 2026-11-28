import type { Store } from "./Store";

/** Thin durable copy of Store for suspend/resume hydrate. */
export interface StoreSnapshot {
  schemaVersion: 1;
  runId: string;
  cancelling: boolean;
  slices: Record<string, unknown>;
  capturedAt: string;
}

export function buildStoreSnapshot(
  store: Store,
  capturedAt: string,
): StoreSnapshot {
  return {
    schemaVersion: 1,
    runId: store.runId,
    cancelling: store.cancelling,
    slices: { ...store.slices },
    capturedAt,
  };
}

export function storeFromSnapshot(snapshot: StoreSnapshot): Store {
  return {
    schemaVersion: 1,
    runId: snapshot.runId,
    createdAt: snapshot.capturedAt,
    updatedAt: snapshot.capturedAt,
    cancelling: snapshot.cancelling,
    slices: { ...snapshot.slices },
  };
}
