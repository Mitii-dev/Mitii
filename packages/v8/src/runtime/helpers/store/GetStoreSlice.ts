import type { Store } from "./Store";

/** Read one named slice from the Store (no mutation). */
export function getStoreSlice<T = unknown>(
  store: Store,
  key: string,
): T | undefined {
  return store.slices[key] as T | undefined;
}
