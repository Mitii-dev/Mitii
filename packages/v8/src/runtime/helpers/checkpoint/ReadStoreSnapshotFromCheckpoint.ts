import type { RuntimeGateCheckpoint } from "../gates/types";
import type { StoreSnapshot } from "../store/StoreSnapshot";

/** Pull a StoreSnapshot out of a gate checkpoint payload when present. */
export function readStoreSnapshotFromCheckpoint(
  checkpoint: RuntimeGateCheckpoint | undefined,
): StoreSnapshot | undefined {
  const raw = checkpoint?.payload?.storeSnapshot;
  if (!raw || typeof raw !== "object") return undefined;
  const snap = raw as Partial<StoreSnapshot>;
  if (
    snap.schemaVersion !== 1 ||
    typeof snap.runId !== "string" ||
    typeof snap.cancelling !== "boolean" ||
    typeof snap.capturedAt !== "string" ||
    typeof snap.slices !== "object" ||
    snap.slices == null
  ) {
    return undefined;
  }
  return {
    schemaVersion: 1,
    runId: snap.runId,
    cancelling: snap.cancelling,
    slices: { ...snap.slices },
    capturedAt: snap.capturedAt,
  };
}
