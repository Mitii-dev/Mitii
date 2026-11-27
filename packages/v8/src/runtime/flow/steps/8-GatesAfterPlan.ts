import { applyGate, evaluateGates } from "../../helpers/gates";
import type { ApplyGateResult } from "../../helpers/gates";
import { resolvePlanExit } from "../../helpers/plan";
import type { PlanArtifact } from "../../../modules/planning";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { PlanPipelineSketch } from "./7-PlanPipeline";
import type { StepContext } from "./StepContext";

/**
 * Step 8 — gates after plan (plan_approval_required, clarify-from-plan, etc.).
 * Exit policy from resolvePlanExit (S3A-EXIT) stamps reason codes; hub still owns I/O.
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

  const planArtifact = ctx.store.getSlice<PlanArtifact>("planArtifact");
  const hollow =
    Boolean(plan.hollowCheck && !plan.hollowCheck.ok) ||
    (planGate === "required_before_execute" &&
      planningDepth === "visible" &&
      !planArtifact);
  const hasReadyPlan = Boolean(planArtifact) && !hollow;

  const planExit =
    plan.planExit ??
    resolvePlanExit({
      mode: ctx.mode,
      route: decision.route,
      planGate,
      planningDepth,
      hollow,
      planRan: true,
    });

  if (hollow && ctx.mode !== "agent") {
    const verdict = evaluateGates("after_plan", {
      runId: ctx.store.getStore().runId,
      mode: ctx.mode,
      route: decision.route,
      runDisposition: "clarification_required",
      planGate,
      hollowPlan: true,
      hasReadyPlan: false,
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
      const enriched: ApplyGateResult = {
        ...result,
        reasonCodes: [
          ...result.reasonCodes,
          ...planExit.reasonCodes,
          "gate_plan_needed_clarify",
        ],
        payload: {
          ...result.payload,
          clarificationPrompt:
            typeof result.payload.clarificationPrompt === "string"
              ? result.payload.clarificationPrompt
              : "Plan needed before building.",
          clarifyOrigin:
            typeof result.payload.clarifyOrigin === "string"
              ? result.payload.clarifyOrigin
              : "hollow_plan",
        },
      };
      ctx.store.setSlice("lastGate", enriched);
      return enriched;
    }
  }

  if (hollow && ctx.mode === "agent") {
    ctx.store.setSlice("lastGate", {
      status: "completed",
      checkpointSaved: false,
      reasonCodes: [
        ...planExit.reasonCodes,
        "gate_hollow_agent_continue",
      ],
      payload: {},
    });
  }

  // Internal plan → no suspend (S3A-EXIT continue_internal).
  if (planExit.kind === "continue_internal") {
    ctx.store.setSlice("lastGate", {
      status: "completed",
      checkpointSaved: false,
      reasonCodes: [...planExit.reasonCodes, "gate_after_plan_continue_internal"],
      payload: {},
    });
    return undefined;
  }

  const verdict = evaluateGates("after_plan", {
    runId: ctx.store.getStore().runId,
    mode: ctx.mode,
    route: decision.route,
    runDisposition: decision.runDisposition,
    planGate,
    planningDepth,
    hasReadyPlan,
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
  ctx.store.setSlice("lastGate", {
    ...result,
    reasonCodes: [...result.reasonCodes, ...planExit.reasonCodes],
  });
  return result;
}