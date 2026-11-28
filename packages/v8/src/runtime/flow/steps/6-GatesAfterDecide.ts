import { applyGate, evaluateGates } from "../../helpers/gates";
import type { ApplyGateResult } from "../../helpers/gates";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

/**
 * Step 6 — gates after decide (clarify suspend, etc.).
 */
export async function gatesAfterDecide(
  ctx: StepContext,
): Promise<ApplyGateResult | undefined> {
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  if (!decision) return undefined;

  const verdict = evaluateGates("after_decide", {
    runId: ctx.store.getStore().runId,
    mode: ctx.mode,
    route: decision.route,
    runDisposition: decision.runDisposition,
  });

  if (!verdict) return undefined;

  const result = await applyGate(
    verdict,
    {
      runId: ctx.store.getStore().runId,
      requestId: ctx.input.runId ?? ctx.store.getStore().runId,
    },
    {
      checkpointStore: ctx.deps?.checkpointStore,
      storeSnapshot: ctx.store.snapshot(),
    },
  );
  ctx.store.setSlice("lastGate", result);
  return result;
}
