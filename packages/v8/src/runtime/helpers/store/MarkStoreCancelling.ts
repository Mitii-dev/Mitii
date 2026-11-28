import type { Store } from "./Store";

/** Mark run as cancelling — StoreManager / cancel path (§20.3). */
export function markStoreCancelling(store: Store, nowIso: string): Store {
  return {
    ...store,
    cancelling: true,
    updatedAt: nowIso,
  };
}
