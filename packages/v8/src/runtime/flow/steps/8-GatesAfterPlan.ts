import { applyGate, evaluateGates } from "../../helpers/gates";
import type { ApplyGateResult } from "../../helpers/gates";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { PlanPipelineSketch } from "./7-PlanPipeline";
import type { StepContext } from "./StepContext";

/**
 * Step 8 — gates after plan (plan_approval_required, clarify-from-plan, etc.).
 */
export async function gatesAfterPlan(
  ctx: StepContext,
): Promise<ApplyGateResult | undefined> {
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  const plan = ctx.store.getSlice<PlanPipelineSketch>("planPipeline");
  if (!decision || !plan?.ran) {
    return undefined;
  }

  // Hollow fail-close → clarification gate when plate said continue
  const planGate =
    decision.planGate === "required_before_execute"
      ? ("required_before_execute" as const)
      : ("none" as const);
  const planningDepth =
    decision.planningDepth === "visible" ||
    decision.planningDepth === "internal"
      ? decision.planningDepth
      : ("none" as const);

  if (plan.hollowCheck && !plan.hollowCheck.ok) {
    const verdict = evaluateGates("after_plan", {
      runId: ctx.store.getStore().runId,
      mode: ctx.mode,
      route: decision.route === "repository_answer" ? "answer" : decision.route,
      runDisposition: "clarification_required",
      planGate,
      hollowPlan: true,
    });
    if (verdict) {
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
  }

  const verdict = evaluateGates("after_plan", {
    runId: ctx.store.getStore().runId,
    mode: ctx.mode,
    route: decision.route === "repository_answer" ? "answer" : decision.route,
    runDisposition: decision.runDisposition,
    planGate,
    planningDepth,
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
