import {
  runEarlyPipeline,
  type RunEarlyPipelineResult,
} from "./RunEarlyPipeline";
import { planPipeline, type PlanPipelineSketch } from "./steps/7-PlanPipeline";
import { gatesAfterPlan } from "./steps/8-GatesAfterPlan";
import type { RuntimeStartInput } from "../contracts/input/RuntimeStartInput";
import type { RuntimeDependencies } from "../ports/RuntimeDependencies";
import type { StoreSnapshot } from "../helpers/store/StoreSnapshot";
import type { ApplyGateResult } from "../helpers/gates";

export interface RunThroughPlanPipelineResult extends RunEarlyPipelineResult {
  planPipeline: PlanPipelineSketch;
  planGate?: ApplyGateResult;
}

/** P3: early pump (1–6) then plan pipeline + gates-after-plan (7–8). */
export async function runThroughPlanPipeline(input: {
  start: RuntimeStartInput;
  mode?: "ask" | "plan" | "agent";
  runId?: string;
  deps?: RuntimeDependencies;
  hydrateSnapshot?: StoreSnapshot;
}): Promise<RunThroughPlanPipelineResult> {
  const early = await runEarlyPipeline(input);

  // Reconstitute step context from early result
  const ctx = {
    store: early.store,
    input: input.start,
    mode: input.mode ?? "agent",
    deps: input.deps,
  };

  // If already suspended (clarify), skip plan
  if (early.gate?.status === "suspended") {
    const skipped = {
      ran: false,
      skippedReason: "already_suspended",
      reasonCodes: ["plan_pipeline_skipped_suspended"],
    } satisfies PlanPipelineSketch;
    early.store.setSlice("planPipeline", skipped);
    return { ...early, planPipeline: skipped };
  }

  const plan = await planPipeline(ctx);
  const planGate = await gatesAfterPlan(ctx);
  return { ...early, planPipeline: plan, planGate };
}
