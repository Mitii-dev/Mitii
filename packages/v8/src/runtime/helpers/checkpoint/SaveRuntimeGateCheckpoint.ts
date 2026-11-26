import type { RuntimeDependencies } from "../../ports/RuntimeDependencies";
import type { GateKind } from "../gates/constants";
import { buildCheckpoint } from "../gates/BuildCheckpoint";
import type { StoreSnapshot } from "../store/StoreSnapshot";
import { attachHandoffsToCheckpointPayload } from "./AttachHandoffsToCheckpointPayload";

/**
 * Persist a suspend checkpoint when composeRuntime wired a checkpointStore
 * and the turn-loop mutation path did not go through applyGate.
 * S13-CHECKPOINT: embeds TaskList + recent handoffs when a store snapshot is present.
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
    /** Live store for handoff peaks when snapshot already taken. */
    liveStore?: {
      getSlice: <T>(key: string) => T | undefined;
    };
  },
): Promise<boolean> {
  const store = deps?.checkpointStore;
  if (!store) return false;

  let payload: Record<string, unknown> = {
    ...(input.payload ?? {}),
    ...(input.storeSnapshot
      ? { storeSnapshot: input.storeSnapshot }
      : {}),
  };

  if (input.liveStore) {
    payload = attachHandoffsToCheckpointPayload({
      payload,
      store: input.liveStore,
    });
  } else if (input.storeSnapshot?.slices) {
    // Snapshot may already carry slices; still stamp handoff marker when present.
    const slices = input.storeSnapshot.slices as Record<string, unknown>;
    if (slices.taskHandoffs || slices.taskList) {
      payload = {
        ...payload,
        taskHandoffs: slices.taskHandoffs,
        taskList: slices.taskList,
        handoffCheckpoint: true,
      };
    }
  }

  const checkpoint = buildCheckpoint({
    runId: input.runId,
    requestId: input.requestId,
    verdict: {
      action: "suspend",
      kind: input.gateKind as GateKind,
      reasonCodes: [
        ...(input.reasonCodes ?? []),
        ...(payload.handoffCheckpoint ? ["checkpoint_handoffs_attached"] : []),
      ],
      payload,
    },
  });
  await store.save(checkpoint);
  return true;
}
