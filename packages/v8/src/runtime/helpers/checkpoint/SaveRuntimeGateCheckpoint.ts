import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { GateKind } from "../gates/constants";
import { buildCheckpoint } from "../gates/BuildCheckpoint";
import type { StoreSnapshot } from "../store/StoreSnapshot";

/**
 * Persist a suspend checkpoint when composeRuntime wired a checkpointStore
 * and the turn-loop mutation path did not go through applyGate.
 */
export async function saveRuntimeGateCheckpoint(
  deps: RuntimeDependencies | undefined,
  input: {
    runId: string;
    requestId: string;
    gateKind: string;
    reasonCodes?: string[];
    payload?: Record<string, unknown>;
    storeSnapshot?: StoreSnapshot;
  },
): Promise<boolean> {
  const store = deps?.checkpointStore;
  if (!store) return false;

  const payload = {
    ...(input.payload ?? {}),
    ...(input.storeSnapshot
      ? { storeSnapshot: input.storeSnapshot }
      : {}),
  };

  const checkpoint = buildCheckpoint({
    runId: input.runId,
    requestId: input.requestId,
    verdict: {
      action: "suspend",
      kind: input.gateKind as GateKind,
      reasonCodes: input.reasonCodes ?? [],
      payload,
    },
  });
  await store.save(checkpoint);
  return true;
}
