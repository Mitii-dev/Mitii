import type {
  AgentEngineRunCheckpointStorePort,
  AgentRunCheckpoint,
} from "../internal/RunCheckpoint";
import { toStoreSuspensionKind } from "./ToStoreSuspensionKind";

/**
 * Sole engine path that persists a suspend checkpoint during cutover.
 * Normalizes hub kinds → store wire kinds, then saves.
 */
export async function saveSuspendedRun(params: {
  store: AgentEngineRunCheckpointStorePort;
  /** Hub may pass GateKind; normalized to store wire before save. */
  checkpoint: Omit<AgentRunCheckpoint, "suspensionKind"> & {
    suspensionKind: string;
  };
}): Promise<AgentRunCheckpoint> {
  const normalized: AgentRunCheckpoint = {
    ...params.checkpoint,
    suspensionKind: toStoreSuspensionKind(params.checkpoint.suspensionKind),
    suspendedAtMs: params.checkpoint.suspendedAtMs ?? Date.now(),
  };
  await params.store.save(normalized);
  return normalized;
}
