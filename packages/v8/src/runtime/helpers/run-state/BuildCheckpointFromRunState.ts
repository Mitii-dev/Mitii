/**
 * RunState → gate checkpoint payload (S11-CP-HYDRATE).
 * Does not perform I/O — caller passes to applyGate / saveRuntimeGateCheckpoint.
 */

import { buildCheckpoint } from "../gates/BuildCheckpoint";
import type { GateKind } from "../gates/constants";
import type { RuntimeGateCheckpoint } from "../gates/types";
import type { RunState } from "./RunState";

export function buildCheckpointFromRunState(input: {
  runState: RunState;
  requestId: string;
  suspensionKind: GateKind | string;
  reasonCodes?: readonly string[];
  extraPayload?: Record<string, unknown>;
  nowMs?: number;
}): RuntimeGateCheckpoint {
  const snapshot = input.runState.snapshot();
  return buildCheckpoint({
    runId: input.runState.runId,
    requestId: input.requestId,
    nowMs: input.nowMs,
    verdict: {
      action: "suspend",
      kind: input.suspensionKind as GateKind,
      reasonCodes: [...(input.reasonCodes ?? []), "run_state_checkpointed"],
      payload: {
        storeSnapshot: snapshot,
        knownKeys: input.runState.knownPresent(),
        ...(input.extraPayload ?? {}),
      },
    },
  });
}
