import { createEmptyStore, type Store } from "./Store";
import { getStoreSlice } from "./GetStoreSlice";
import { markStoreCancelling } from "./MarkStoreCancelling";
import { setStoreSlice } from "./SetStoreSlice";
import {
  packTurn as buildPackTurn,
  type ModelRequestSketch,
  type PackTurnInput,
} from "./PackTurn";
import {
  buildStoreSnapshot,
  storeFromSnapshot,
  type StoreSnapshot,
} from "./StoreSnapshot";

export type StoreClock = () => string;
export type { StoreSnapshot };

/**
 * Sole API that reads/writes Store (§0.1).
 * packTurn builds throwaway ModelRequest; snapshot/hydrate for suspend resume.
 */
export class StoreManager {
  private store: Store;

  constructor(
    initial: Store,
    private readonly clock: StoreClock = () => new Date().toISOString(),
  ) {
    this.store = initial;
  }

  static create(runId: string, clock?: StoreClock): StoreManager {
    const now = (clock ?? (() => new Date().toISOString()))();
    return new StoreManager(createEmptyStore({ runId, nowIso: now }), clock);
  }

  getStore(): Store {
    return this.store;
  }

  getSlice<T = unknown>(key: string): T | undefined {
    return getStoreSlice<T>(this.store, key);
  }

  setSlice(key: string, value: unknown): void {
    this.store = setStoreSlice(this.store, key, value, this.clock());
  }

  requestCancel(): void {
    this.store = markStoreCancelling(this.store, this.clock());
  }

  isCancelling(): boolean {
    return this.store.cancelling;
  }

  /** Locked copy for gate checkpoint payload / durable hydrate. */
  snapshot(): StoreSnapshot {
    return buildStoreSnapshot(this.store, this.clock());
  }

  /** Restore a prior snapshot (same runId). Replaces live slices. */
  hydrate(snapshot: StoreSnapshot): void {
    if (snapshot.runId !== this.store.runId) {
      throw new Error("store_hydrate_run_id_mismatch");
    }
    this.store = storeFromSnapshot({
      ...snapshot,
      capturedAt: this.clock(),
    });
  }

  /** Prompt ⊆ grant — tools on the request never exceed the grant surface. */
  packTurn(input: PackTurnInput): ModelRequestSketch {
    return buildPackTurn(input);
  }
}
