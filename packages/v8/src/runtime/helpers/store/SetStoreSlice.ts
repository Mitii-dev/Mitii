import type { Store } from "./Store";

/** Immutable set of one named slice; bumps updatedAt. */
export function setStoreSlice(
  store: Store,
  key: string,
  value: unknown,
  nowIso: string,
): Store {
  return {
    ...store,
    updatedAt: nowIso,
    slices: {
      ...store.slices,
      [key]: value,
    },
  };
}
