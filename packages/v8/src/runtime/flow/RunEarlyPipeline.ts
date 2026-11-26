import { StoreManager } from "../helpers/store";
import type { StoreSnapshot } from "../helpers/store/StoreSnapshot";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import type { RuntimeDependencies } from "../ports/RuntimeDependencies";
import { applyWindowPolicy } from "./steps/1-ApplyWindowPolicy";
import { orientSituation } from "./steps/2-OrientSituation";
import { attachPreDecideMaterialsStep } from "./steps/2b-AttachPreDecideMaterials";
import { assessDirection } from "./steps/3-AssessDirection";
import { fetchEphemeralPeeks } from "./steps/4-FetchEphemeralPeeks";
import { decide } from "./steps/5-Decide";
import { gatesAfterDecide } from "./steps/6-GatesAfterDecide";
import type { StepContext } from "./steps/StepContext";

export interface RunEarlyPipelineResult {
  store: StoreManager;
  decision: ReturnType<typeof decide>;
  gate?: Awaited<ReturnType<typeof gatesAfterDecide>>;
  hydratedFromSnapshot?: boolean;
}

/** P2 early pump: window → orient → assess → peeks → decide → gates. */
export async function runEarlyPipeline(input: {
  start: RuntimeStartInput;
  mode?: "ask" | "plan" | "agent";
  runId?: string;
  deps?: RuntimeDependencies;
  /** Prior Store snapshot from gate checkpoint (resume hydrate). */
  hydrateSnapshot?: StoreSnapshot;
}): Promise<RunEarlyPipelineResult> {
  const runId = input.runId ?? input.start.runId ?? `run_${Date.now()}`;
  const store = StoreManager.create(runId);
  let hydratedFromSnapshot = false;
  if (input.hydrateSnapshot && input.hydrateSnapshot.runId === runId) {
    store.hydrate(input.hydrateSnapshot);
    hydratedFromSnapshot = true;
  }
  const ctx: StepContext = {
    store,
    input: input.start,
    mode: input.mode ?? "agent",
    deps: input.deps,
  };

  applyWindowPolicy(ctx);
  orientSituation(ctx);
  await attachPreDecideMaterialsStep(ctx);
  await assessDirection(ctx);
  await fetchEphemeralPeeks(ctx);
  const decision = decide(ctx);
  const gate = await gatesAfterDecide(ctx);

  return { store, decision, gate, hydratedFromSnapshot };
}
