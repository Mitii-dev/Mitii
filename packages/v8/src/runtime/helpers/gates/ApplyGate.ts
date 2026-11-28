import type { StoreSnapshot } from "../store/StoreSnapshot";
import { buildCheckpoint } from "./BuildCheckpoint";
import type { GateVerdict } from "./kinds";
import type {
  ApplyGateResult,
  GateCheckpointStorePort,
} from "./types";

export interface ApplyGateDeps {
  checkpointStore?: GateCheckpointStorePort;
  nowMs?: () => number;
  /** Optional Store snapshot embedded in checkpoint payload for resume hydrate. */
  storeSnapshot?: StoreSnapshot;
}

/**
 * Sole side-effect entry for gates: checkpoint on suspend, complete otherwise.
 * Soft rails must never call this — only evaluateGates → applyGate.
 */
export async function applyGate(
  verdict: GateVerdict,
  ids: { runId: string; requestId: string },
  deps: ApplyGateDeps = {},
): Promise<ApplyGateResult> {
  if (verdict.action === "complete") {
    return {
      status: "completed",
      terminal: verdict.terminal,
      checkpointSaved: false,
      reasonCodes: verdict.reasonCodes ?? [],
      payload: verdict.payload ?? {},
    };
  }

  const payload = {
    ...(verdict.payload ?? {}),
    ...(deps.storeSnapshot
      ? { storeSnapshot: deps.storeSnapshot }
      : {}),
  };

  const checkpoint = buildCheckpoint({
    runId: ids.runId,
    requestId: ids.requestId,
    verdict: {
      ...verdict,
      payload,
    },
    nowMs: deps.nowMs?.(),
  });

  let checkpointSaved = false;
  if (deps.checkpointStore) {
    await deps.checkpointStore.save(checkpoint);
    checkpointSaved = true;
  }

  return {
    status: "suspended",
    kind: verdict.kind,
    checkpointSaved,
    reasonCodes: verdict.reasonCodes ?? [],
    payload,
  };
}
