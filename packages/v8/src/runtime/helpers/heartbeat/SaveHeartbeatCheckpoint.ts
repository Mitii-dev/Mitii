/**
 * Persist a non-user-facing heartbeat checkpoint (S11-HEART).
 * Resume = continue loop without a host decision.
 */

import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { RuntimeGateCheckpoint } from "../gates/types";
import { RunState } from "../run-state/RunState";
import type { StoreManager } from "../store/StoreManager";
import {
  selectHeartbeatPolicy,
  type SelectHeartbeatPolicyInput,
} from "./SelectHeartbeatPolicy";
import { shouldSaveHeartbeatCheckpoint } from "./ShouldSaveHeartbeatCheckpoint";

export const HEARTBEAT_CHECKPOINT_KIND = "heartbeat" as const;

export function buildHeartbeatCheckpoint(input: {
  runId: string;
  requestId: string;
  store: StoreManager;
  reasonCodes?: readonly string[];
  nowMs?: number;
}): RuntimeGateCheckpoint {
  const runState = RunState.from(input.store);
  const snapshot = runState.snapshot();
  return {
    runId: input.runId,
    requestId: input.requestId,
    suspensionKind: HEARTBEAT_CHECKPOINT_KIND,
    payload: {
      storeSnapshot: snapshot,
      knownKeys: runState.knownPresent(),
      heartbeat: true,
    },
    reasonCodes: [
      ...(input.reasonCodes ?? []),
      "heartbeat_checkpointed",
      "run_state_checkpointed",
    ],
    suspendedAtMs: input.nowMs ?? Date.now(),
  };
}

export interface MaybeSaveHeartbeatCheckpointInput {
  deps?: RuntimeDependencies;
  store: StoreManager;
  runId: string;
  requestId?: string;
  mode?: SelectHeartbeatPolicyInput["mode"];
  route?: string;
  turnCount: number;
  turnsSinceLastHeartbeat: number;
  mutationBatchSucceeded?: boolean;
  /** Explicit host override; undefined → policy default. */
  heartbeat?: boolean;
  heartbeatEveryTurns?: number;
}

export interface MaybeSaveHeartbeatCheckpointResult {
  saved: boolean;
  policyEnabled: boolean;
  reasonCodes: string[];
}

/**
 * Policy + due check + optional durable save when checkpointStore is composed.
 */
export async function maybeSaveHeartbeatCheckpoint(
  input: MaybeSaveHeartbeatCheckpointInput,
): Promise<MaybeSaveHeartbeatCheckpointResult> {
  const policy = selectHeartbeatPolicy({
    mode: input.mode,
    route: input.route,
    heartbeat: input.heartbeat,
    heartbeatEveryTurns: input.heartbeatEveryTurns,
  });

  const due = shouldSaveHeartbeatCheckpoint({
    policy,
    turnCount: input.turnCount,
    turnsSinceLastHeartbeat: input.turnsSinceLastHeartbeat,
    mutationBatchSucceeded: input.mutationBatchSucceeded,
    heartbeatEnabled: input.heartbeat,
  });

  if (!due.save) {
    return {
      saved: false,
      policyEnabled: policy.enabled,
      reasonCodes: [...policy.reasonCodes, ...due.reasonCodes],
    };
  }

  const store = input.deps?.checkpointStore;
  if (!store) {
    return {
      saved: false,
      policyEnabled: policy.enabled,
      reasonCodes: [
        ...policy.reasonCodes,
        ...due.reasonCodes,
        "heartbeat_no_checkpoint_store",
      ],
    };
  }

  const checkpoint = buildHeartbeatCheckpoint({
    runId: input.runId,
    requestId: input.requestId ?? input.runId,
    store: input.store,
    reasonCodes: [...policy.reasonCodes, ...due.reasonCodes],
  });
  await store.save(checkpoint);

  input.store.setSlice("lastHeartbeat", {
    atMs: checkpoint.suspendedAtMs,
    turnCount: input.turnCount,
  });

  return {
    saved: true,
    policyEnabled: true,
    reasonCodes: [...checkpoint.reasonCodes, "heartbeat_saved"],
  };
}
