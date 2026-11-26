import {
  resolveDiscoveryPassBudget,
  type DiscoveryPassBudget,
} from "../../../modules/window-budget";
import { PlanningPipeline } from "../../../modules/planning";
import type { PlanningResult } from "../../../modules/planning";
import {
  rejectHollowPlan,
  shouldRunPlanPipeline,
} from "../../helpers/plan";
import { buildPlanningInputFromRuntime } from "../../helpers/plan/BuildPlanningInputFromRuntime";
import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

export interface PlanPipelineSketch {
  ran: boolean;
  skippedReason?: string;
  discoveryBudget?: DiscoveryPassBudget;
  hollowCheck?: ReturnType<typeof rejectHollowPlan>;
  planningStatus?: PlanningResult["status"];
  planTitle?: string;
  reasonCodes: string[];
}

/**
 * Step 7 — Plan 3A via modules/planning PlanningPipeline.
 */
export async function planPipeline(
  ctx: StepContext,
): Promise<PlanPipelineSketch> {
  const decision = ctx.store.getSlice<RuntimeDecisionSketch>("decision");
  if (!decision) {
    const sketch: PlanPipelineSketch = {
      ran: false,
      skippedReason: "no_decision",
      reasonCodes: ["plan_pipeline_skipped_no_decision"],
    };
    ctx.store.setSlice("planPipeline", sketch);
    return sketch;
  }

  if (
    !shouldRunPlanPipeline({
      route: decision.route,
      planningDepth: decision.planningDepth,
    })
  ) {
    const sketch: PlanPipelineSketch = {
      ran: false,
      skippedReason: "route_or_depth",
      reasonCodes: ["plan_pipeline_skipped_by_route"],
    };
    ctx.store.setSlice("planPipeline", sketch);
    return sketch;
  }

  const windowTokens =
    (ctx.store.getSlice<{ contextWindowTokens?: number }>("windowPolicy")
      ?.contextWindowTokens as number | undefined) ?? 80_000;

  const discoveryBudget = resolveDiscoveryPassBudget("medium", windowTokens);
  const assessment = ctx.store.getSlice<TaskDirectionAssessment>("assessment");
  const pack = ctx.store.getSlice<SituationPack>("situationPack");

  if (!assessment) {
    const sketch: PlanPipelineSketch = {
      ran: false,
      skippedReason: "no_assessment",
      reasonCodes: ["plan_pipeline_skipped_no_assessment"],
    };
    ctx.store.setSlice("planPipeline", sketch);
    return sketch;
  }

  const planning = new PlanningPipeline();
  const input = buildPlanningInputFromRuntime({
    pack,
    assessment,
    decision,
    mode: ctx.mode ?? "agent",
  });

  const result = await planning.plan(input);
  const artifact = result.plan;
  if (artifact) {
    ctx.store.setSlice("planArtifact", artifact);
  }

  const hollowCheck = artifact
    ? rejectHollowPlan({
        title: artifact.title,
        phases: artifact.phases?.map((phase) => ({
          name: phase.name,
          steps: phase.steps,
        })),
      })
    : result.status === "ok"
      ? ({ ok: false, reasonCode: "plan_hollow_no_artifact" } as const)
      : ({ ok: true } as const);

  const sketch: PlanPipelineSketch = {
    ran: true,
    discoveryBudget,
    hollowCheck,
    planningStatus: result.status,
    planTitle: artifact?.title,
    reasonCodes: [
      "plan_pipeline_module_wired",
      `plan_pipeline_depth_${decision.planningDepth}`,
      `plan_status_${result.status}`,
      ...result.reasonCodes.slice(0, 8),
      ...(hollowCheck.ok
        ? ["plan_hollow_check_passed"]
        : ["plan_hollow_rejected", hollowCheck.reasonCode]),
    ],
  };
  ctx.store.setSlice("planPipeline", sketch);
  return sketch;
}
