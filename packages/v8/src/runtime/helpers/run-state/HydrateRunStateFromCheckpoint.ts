/**
 * Checkpoint payload → hydrate RunState (S11-CP-HYDRATE).
 */

import type { RuntimeGateCheckpoint } from "../gates/types";
import type { StoreSnapshot } from "../store/StoreSnapshot";
import type { RunState } from "./RunState";

export interface HydrateRunStateFromCheckpointResult {
  hydrated: boolean;
  reasonCodes: string[];
  suspensionKind?: string;
}

/**
 * Restore storeroom from a checkpoint that carried `storeSnapshot`.
 * Returns hydrated=false when payload has no snapshot (legacy thin checkpoints).
 */
export function hydrateRunStateFromCheckpoint(
  runState: RunState,
  checkpoint: RuntimeGateCheckpoint,
): HydrateRunStateFromCheckpointResult {
  const raw = checkpoint.payload?.storeSnapshot;
  if (!raw || typeof raw !== "object") {
    return {
      hydrated: false,
      reasonCodes: ["run_state_hydrate_no_snapshot"],
      suspensionKind: checkpoint.suspensionKind,
    };
  }

  const snapshot = raw as StoreSnapshot;
  if (snapshot.runId !== runState.runId) {
    return {
      hydrated: false,
      reasonCodes: ["run_state_hydrate_run_id_mismatch"],
      suspensionKind: checkpoint.suspensionKind,
    };
  }

  runState.hydrate(snapshot);
  return {
    hydrated: true,
    reasonCodes: ["run_state_hydrated_from_checkpoint"],
    suspensionKind: checkpoint.suspensionKind,
  };
}
