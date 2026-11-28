import {
  resolveDiscoveryPassBudget,
  type DiscoveryPassBudget,
} from "../../../modules/window-budget";
import { PlanningPipeline } from "../../../modules/planning";
import type { DiscoveryBrief, PlanningResult } from "../../../modules/planning";
import {
  assemblePlanQualityGates,
  beginDiscoveryTaskList,
  emitPlanPhaseTelemetry,
  enforcePlanQuality,
  materializeExecutionDesk,
  rejectHollowPlan,
  resolvePlanExit,
  shouldRunPlanPipeline,
  type PlanPhaseTelemetry,
} from "../../helpers/plan";
import { buildPlanningInputFromRuntime } from "../../helpers/plan/BuildPlanningInputFromRuntime";
import {
  clipDiscoveryObjective,
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
  quality?: ReturnType<typeof enforcePlanQuality>;
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

  const discoverGate = shouldRunDiscoveryPass({
    mode: ctx.mode,
    route: decision.route,
    planningDepth: decision.planningDepth,
    taskSize,
  });
  let discoveryResult: RunDiscoveryPassResult | undefined;
  let discoveryBrief: DiscoveryBrief | undefined;

  if (discoverGate.run) {
    const priorDesk = ctx.store.getSlice<{
      purpose?: string;
      source?: string;
      items?: unknown[];
    }>("taskList");
    const sealedBeforeDiscovery =
      Boolean(priorDesk?.items?.length) &&
      priorDesk?.purpose !== "discovery" &&
      priorDesk?.source !== "discovery";
    // Never clobber a sealed campaign checklist with a temp discovery list.
    if (!sealedBeforeDiscovery) {
      const discoveryList = beginDiscoveryTaskList(
        pack?.request?.text?.slice(0, 80) ?? "Investigating request",
      );
      ctx.store.setSlice("taskList", discoveryList.taskList);
    }

    const toolsAvailable = ctx.deps?.tools != null;
    discoveryResult = await runDiscoveryPass({
      objective: clipDiscoveryObjective(
        pack?.request?.text?.trim() ||
          "Discover repository evidence for planning",
      ),
      pack,
      budget: discoveryBudget,
      tools: ctx.deps?.tools,
      requireQualityFloor:
        toolsAvailable &&
        (ctx.mode === "plan" ||
          taskSize === "medium" ||
          taskSize === "large" ||
          decision.planningDepth === "visible"),
    });
    discoveryBrief = discoveryResult.brief;
    ctx.store.setSlice("discoveryBrief", discoveryBrief);
  }

  const planning = new PlanningPipeline({
    llm: ctx.deps?.planningLlm,
  });
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

  const gates = assemblePlanQualityGates({
    artifact,
    planningStatus: result.status,
    planningDepth: decision.planningDepth,
    mode: ctx.mode,
    discoveryQualityOk: discoveryResult?.quality.ok,
    discoveryRan: Boolean(discoveryResult),
  });
  const { hollowCheck, quality, effectiveHollow, discoveryQualityFailed } =
    gates;

  const currentDesk = ctx.store.getSlice<{
    purpose?: string;
    source?: string;
    items?: unknown[];
  }>("taskList");
  // Cursor-like: one sealed campaign checklist. Never grow / replace an open
  // execution desk on re-plan; materializeExecutionDesk owns the ladder.
  let derived: ReturnType<typeof materializeExecutionDesk> = {
    status: "skipped",
    softSeeded: false,
    clearedWeak: false,
    reasonCodes: ["tasklist_derive_deferred"],
  };
  if (ctx.mode === "agent" || decision.route === "plan") {
    derived = materializeExecutionDesk({
      plan: artifact,
      seedText:
        artifact?.objective?.trim() || pack?.request?.text?.trim() || undefined,
      maxTasks: ctx.store.getSlice<{ taskList?: { maxTasks?: number } }>(
        "windowPolicy",
      )?.taskList?.maxTasks,
      current: currentDesk as never,
    });
    if (derived.taskList && derived.taskList.items.length > 0) {
      ctx.store.setSlice("taskList", derived.taskList);
    } else if (derived.clearedWeak) {
      ctx.store.setSlice("taskList", undefined);
    } else if (
      currentDesk?.purpose === "discovery" ||
      currentDesk?.source === "discovery"
    ) {
      // Never leave canned discovery rows as the host Continue target after plan.
      ctx.store.setSlice("taskList", undefined);
      derived = {
        ...derived,
        clearedWeak: true,
        reasonCodes: [
          ...derived.reasonCodes,
          "tasklist_cleared_discovery_after_plan",
        ],
      };
    }
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
          reasonCode: !quality.ok
            ? "plan_quality_failed"
            : discoveryQualityFailed
              ? "plan_hollow_discovery_quality"
              : hollowCheck.ok
                ? "plan_hollow_discovery_quality"
                : hollowCheck.reasonCode,
        } as const)
      : hollowCheck,
    quality,
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
              : !hollowCheck.ok
                ? hollowCheck.reasonCode
                : "plan_hollow_unknown",
          ]),
      ...quality.reasonCodes,
      ...derived.reasonCodes,
      ...planExit.reasonCodes,
      ...telemetry.reasonCodes,
    ],
  };
  ctx.store.setSlice("planPipeline", sketch);
  return sketch;
}
