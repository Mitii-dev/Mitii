import {
  resolveDiscoveryPassBudget,
  type DiscoveryPassBudget,
} from "../../../modules/window-budget";
import { PlanningPipeline } from "../../../modules/planning";
import type { DiscoveryBrief, PlanningResult } from "../../../modules/planning";
import {
  beginDiscoveryTaskList,
  deriveTaskListAfterPlan,
  emitPlanPhaseTelemetry,
  rejectHollowPlan,
  resolvePlanExit,
  shouldRunPlanPipeline,
  type PlanPhaseTelemetry,
} from "../../helpers/plan";
import { buildPlanningInputFromRuntime } from "../../helpers/plan/BuildPlanningInputFromRuntime";
import {
  runDiscoveryPass,
  shouldRunDiscoveryPass,
  type RunDiscoveryPassResult,
} from "../../helpers/plan-discovery";
import type { TaskDirectionAssessment } from "../../contracts/assess/TaskDirectionAssessment";
import type { SituationPack } from "../../contracts/orient/SituationPack";
import type { RuntimeDecisionSketch } from "./5-Decide";
import type { StepContext } from "./StepContext";

export interface PlanPipelineSketch {
  ran: boolean;
  skippedReason?: string;
  discoveryBudget?: DiscoveryPassBudget;
  discovery?: {
    ran: boolean;
    qualityOk?: boolean;
    toolCalls?: number;
    fileReads?: number;
  };
  hollowCheck?: ReturnType<typeof rejectHollowPlan>;
  planningStatus?: PlanningResult["status"];
  planTitle?: string;
  taskListDerived?: boolean;
  planExit?: ReturnType<typeof resolvePlanExit>;
  telemetry?: PlanPhaseTelemetry;
  reasonCodes: string[];
}

/**
 * Step 7 — Plan 3A: optional discovery pump → PlanningPipeline → TaskList / exit.
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

  const assessment = ctx.store.getSlice<TaskDirectionAssessment>("assessment");
  const pack = ctx.store.getSlice<SituationPack>("situationPack");
  const taskSize =
    assessment?.taskBand === "medium" || assessment?.taskBand === "large"
      ? assessment.taskBand
      : "small";

  const discoveryBudget = resolveDiscoveryPassBudget(taskSize, windowTokens);

  if (!assessment) {
    const sketch: PlanPipelineSketch = {
      ran: false,
      skippedReason: "no_assessment",
      reasonCodes: ["plan_pipeline_skipped_no_assessment"],
    };
    ctx.store.setSlice("planPipeline", sketch);
    return sketch;
  }

  // S3A-DISCOVER — temp discovery TaskList + bounded readonly pass.
  const discoverGate = shouldRunDiscoveryPass({
    mode: ctx.mode,
    route: decision.route,
    planningDepth: decision.planningDepth,
    taskSize,
  });
  let discoveryResult: RunDiscoveryPassResult | undefined;
  let discoveryBrief: DiscoveryBrief | undefined;

  if (discoverGate.run) {
    const discoveryList = beginDiscoveryTaskList(
      pack?.request?.text?.slice(0, 80) ?? "Investigating request",
    );
    ctx.store.setSlice("taskList", discoveryList.taskList);

    discoveryResult = await runDiscoveryPass({
      objective:
        pack?.request?.text?.trim() ||
        "Discover repository evidence for planning",
      pack,
      budget: discoveryBudget,
      tools: ctx.deps?.tools,
      requireQualityFloor:
        ctx.mode === "plan" ||
        taskSize === "medium" ||
        taskSize === "large" ||
        decision.planningDepth === "visible",
    });
    discoveryBrief = discoveryResult.brief;
    ctx.store.setSlice("discoveryBrief", discoveryBrief);
  }

  const planning = new PlanningPipeline();
  const input = buildPlanningInputFromRuntime({
    pack,
    assessment,
    decision,
    mode: ctx.mode ?? "agent",
    discoveryBrief,
  });

  const result = await planning.plan(input);
  const artifact = result.plan;
  if (artifact) {
    ctx.store.setSlice("planArtifact", artifact);
  }

  const hollowCheck = artifact
    ? rejectHollowPlan({
        title: artifact.objective,
        phases: artifact.phases?.map((phase) => ({
          name: phase.name,
          steps: phase.steps,
        })),
      })
    : result.status === "ok"
      ? ({ ok: false, reasonCode: "plan_hollow_no_artifact" } as const)
      : ({ ok: true } as const);

  // Hollow when discovery quality floor failed (required passes only).
  const discoveryQualityFailed =
    discoveryResult != null && !discoveryResult.quality.ok;

  const effectiveHollow = !hollowCheck.ok || discoveryQualityFailed;

  // S3A-TASKLIST — replace discovery temp list with execution checklist.
  const derived = deriveTaskListAfterPlan({
    plan: artifact,
    maxTasks: ctx.store.getSlice<{ taskList?: { maxTasks?: number } }>(
      "windowPolicy",
    )?.taskList?.maxTasks,
  });
  if (derived.taskList) {
    ctx.store.setSlice("taskList", derived.taskList);
  }

  const planExit = resolvePlanExit({
    mode: ctx.mode,
    route: decision.route,
    planGate:
      decision.planGate === "required_before_execute"
        ? "required_before_execute"
        : "none",
    planningDepth:
      decision.planningDepth === "visible" ||
      decision.planningDepth === "internal"
        ? decision.planningDepth
        : "none",
    hollow: effectiveHollow,
    planRan: true,
  });
  ctx.store.setSlice("planExit", planExit);

  const windowBand = ctx.store.getSlice<{
    band?: string;
    planBudget?: { maxModelCalls?: number; maxToolCalls?: number };
    executeBudget?: { maxModelCalls?: number; maxToolCalls?: number };
  }>("windowBand");

  const telemetry = emitPlanPhaseTelemetry({
    band: windowBand?.band,
    contextWindowTokens: windowTokens,
    discoveryBudget,
    planBudget: windowBand?.planBudget,
    executeBudget: windowBand?.executeBudget,
    grantMaxToolCalls: decision.toolGrant?.limits?.maxToolCalls,
    discoveryRan: Boolean(discoveryResult),
    discoveryQualityOk: discoveryResult?.quality.ok,
    extraReasonCodes: discoverGate.reasonCodes,
  });
  ctx.store.setSlice("planTelemetry", telemetry);

  const sketch: PlanPipelineSketch = {
    ran: true,
    discoveryBudget,
    discovery: {
      ran: Boolean(discoveryResult),
      qualityOk: discoveryResult?.quality.ok,
      toolCalls: discoveryResult?.toolCalls,
      fileReads: discoveryResult?.fileReads,
    },
    hollowCheck: effectiveHollow
      ? ({
          ok: false,
          reasonCode: discoveryQualityFailed
            ? "plan_hollow_discovery_quality"
            : hollowCheck.ok
              ? "plan_hollow_discovery_quality"
              : hollowCheck.reasonCode,
        } as const)
      : hollowCheck,
    planningStatus: result.status,
    planTitle: artifact?.objective,
    taskListDerived: derived.status === "applied",
    planExit,
    telemetry,
    reasonCodes: [
      "plan_pipeline_module_wired",
      `plan_pipeline_depth_${decision.planningDepth}`,
      `plan_status_${result.status}`,
      ...result.reasonCodes.slice(0, 8),
      ...discoverGate.reasonCodes,
      ...(discoveryResult?.reasonCodes.slice(0, 8) ?? []),
      ...(hollowCheck.ok && !effectiveHollow
        ? ["plan_hollow_check_passed"]
        : [
            "plan_hollow_rejected",
            effectiveHollow
              ? "plan_hollow_discovery_or_artifact"
              : hollowCheck.reasonCode,
          ]),
      ...derived.reasonCodes,
      ...planExit.reasonCodes,
      ...telemetry.reasonCodes,
    ],
  };
  ctx.store.setSlice("planPipeline", sketch);
  return sketch;
}
