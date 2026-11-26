/**
 * Live storeroom facade over StoreManager (§11.10 / S11-RS).
 * Briefcase is derived; this is the visit inventory.
 */

import type { StoreManager } from "../store/StoreManager";
import type { StoreSnapshot } from "../store/StoreSnapshot";
import { isRunStateKey, type RunStateKey } from "./RunStateKeys";

export interface RunStateView {
  runId: string;
  cancelling: boolean;
  keys: string[];
}

/**
 * Typed-ish accessors for known slices. Unknown keys still allowed for growth.
 */
export class RunState {
  constructor(private readonly store: StoreManager) {}

  static from(store: StoreManager): RunState {
    return new RunState(store);
  }

  get runId(): string {
    return this.store.getStore().runId;
  }

  get cancelling(): boolean {
    return this.store.isCancelling();
  }

  view(): RunStateView {
    return {
      runId: this.runId,
      cancelling: this.cancelling,
      keys: Object.keys(this.store.getStore().slices ?? {}),
    };
  }

  get<T = unknown>(key: RunStateKey | string): T | undefined {
    return this.store.getSlice<T>(key);
  }

  set(key: RunStateKey | string, value: unknown): void {
    this.store.setSlice(key, value);
  }

  has(key: RunStateKey | string): boolean {
    return this.store.getSlice(key) !== undefined;
  }

  /** Known catalog keys currently populated. */
  knownPresent(): RunStateKey[] {
    return this.view().keys.filter(isRunStateKey);
  }

  snapshot(): StoreSnapshot {
    return this.store.snapshot();
  }

  hydrate(snapshot: StoreSnapshot): void {
    this.store.hydrate(snapshot);
  }

  /** Underlying manager for flow steps that still take StoreManager. */
  asStoreManager(): StoreManager {
    return this.store;
  }
}
