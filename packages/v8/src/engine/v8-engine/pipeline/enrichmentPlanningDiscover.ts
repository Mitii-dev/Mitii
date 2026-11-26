/**
 * Live planning draft: strategy, discovery pass, impact, plan(), post-plan gates.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  collectDiscoveryImpactSeedPaths,
  collectPlanningImpactReports,
} from "../../../modules/planning";
import type {
  PromptInstructions,
  PromptRepositoryContext,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { runPostPlanDraftGates } from "./enrichmentAfterPlanDraft";
import { boundImpactSeedsForPlanScope } from "../modules/plan-discovery";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import { runEnrichmentPlanningDiscoveryPhase } from "./enrichmentPlanningDiscoveryPhase";
import { setupEnrichmentPlanningStrategy } from "./enrichmentPlanningStrategySetup";

export async function runLiveEnrichmentPlanning(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  runEvidence: RunEvidence;
  syncTaskListOnce: () => void;
  envelope: UserRequestEnvelope;
  candidateRelativePaths: string[];
  skipPlanGate: boolean;
  finish: (partial: {
    status: AgentRunStatus;
    route?: AgentRunResult["route"];
    planningDepth?: AgentRunResult["planningDepth"];
    answer?: string;
    plan?: AgentRunResult["plan"];
    suspension?: AgentRunResult["suspension"];
    pinnedState?: import("../../../modules/repository-state").RepositoryStateReference;
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  repositoryContext: PromptRepositoryContext | undefined;
  contextPaths: string[];
  selectedSkills: PromptInstructions["skills"];
}): Promise<{ planText: string | undefined; terminal?: StartEnrichmentOutcome }> {
  const {
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    runEvidence,
    syncTaskListOnce,
    envelope,
    candidateRelativePaths,
    skipPlanGate,
    finish,
    understanding,
    decision,
    repositoryContext,
    contextPaths,
    selectedSkills,
  } = params;

  let planText: string | undefined;

  runtime.emitStage(bus, runId, "plan_ready", "started");
  const setup = setupEnrichmentPlanningStrategy({
    envelope,
    understanding,
    input,
    contextPaths,
    repositoryContext,
    selectedSkills,
    shared,
    windowPolicy,
    decision,
    reasonCodes,
  });
  const {
    planningInput,
    mediumOrLarge,
    resolvedScopeId,
    scopeChoiceResolved,
    discoveryPreferredPaths,
    discoveryBudgetOverride,
    discoveryScopeHint,
    thoroughEvidence,
    planQualityFloor,
  } = setup;
  let strategyOverride = setup.strategyOverride;

  const discoveryPhase = await runEnrichmentPlanningDiscoveryPhase({
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    shared,
    taskListRef,
    runEvidence,
    decision,
    planningInput,
    strategyOverride,
    discoveryPreferredPaths,
    discoveryBudgetOverride,
    discoveryScopeHint,
    contextPaths,
    candidateRelativePaths,
    planQualityFloor,
    thoroughEvidence,
    mediumOrLarge,
    scopeChoiceResolved,
  });
  strategyOverride = discoveryPhase.strategyOverride;
  const discoveryBrief = discoveryPhase.discoveryBrief;

  let impactReports = planningInput.impactReports;
  let impactSeedPaths =
    strategyOverride.strategy === "follow_evidence"
      ? [
          ...(shared.executionSeed?.paths ?? []),
          ...(planningInput.buildEvidence?.diagnostics ?? [])
            .filter((diagnostic) => diagnostic.severity === "error")
            .map((diagnostic) => diagnostic.path),
        ]
      : strategyOverride.strategy === "discover_and_plan" && discoveryBrief
        ? [
            ...(shared.executionSeed?.paths ?? []),
            ...collectDiscoveryImpactSeedPaths(discoveryBrief),
          ]
        : [...(shared.executionSeed?.paths ?? [])];
  impactSeedPaths = boundImpactSeedsForPlanScope(
    impactSeedPaths,
    resolvedScopeId,
  );
  if (impactSeedPaths.length > 0) {
    impactReports = await collectPlanningImpactReports({
      repoGraphs: runtime.deps.repoGraphs,
      seedPaths: impactSeedPaths,
    });
  }

  const planning = runtime.deps.planning!;
  let planningResult = await planning.plan({
    ...planningInput,
    discoveryBrief,
    strategyOverride,
    ...(impactReports && impactReports.length > 0
      ? { impactReports }
      : {}),
  });

  // Scope already chosen but Planning still clarified — force a concrete draft.
  if (
    scopeChoiceResolved &&
    planningResult.strategy?.strategy === "clarify"
  ) {
    if (!reasonCodes.includes("plan_scope_choice_honored")) {
      reasonCodes.push("plan_scope_choice_honored");
    }
    planningResult = await planning.plan({
      ...planningInput,
      discoveryBrief,
      strategyOverride: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale:
          "Plan scope choice already resolved; draft a concrete plan from discovery evidence.",
        skipDiscover: true,
        useBuildEvidence: false,
        confidence: strategyOverride.confidence ?? 0.7,
      },
      ...(impactReports && impactReports.length > 0
        ? { impactReports }
        : {}),
    });
  }

  if (planningResult.plan) {
    const postPlan = await runPostPlanDraftGates({
      runtime,
      runId,
      input,
      bus,
      budget,
      reasonCodes,
      warnings,
      startedMs,
      shared,
      taskListRef,
      runEvidence,
      envelope,
      decision,
      planningResult: {
        plan: planningResult.plan,
        strategy: planningResult.strategy,
        clarifyDraft: planningResult.clarifyDraft,
      },
      planningInput,
      discoveryBrief,
      mediumOrLarge,
      scopeChoiceResolved,
      planQualityFloor,
      skipPlanGate,
      syncTaskListOnce,
      finish,
    });
    planText = postPlan.planText;
    if (postPlan.terminal) {
      return { planText: postPlan.planText, terminal: postPlan.terminal };
    }
  } else {
    reasonCodes.push("plan_skipped");
    warnings.push(...planningResult.warnings);
    if (planningResult.status === "blocked") {
      // Distinguish unneeded vs rejected planning (both were plan_skipped).
      if (logVerbosityAtLeast(input.logVerbosity, "standard")) {
        runtime.emit(bus, {
          type: "warning",
          runId,
          message:
            planningResult.warnings[0] ??
            "Plan draft was rejected by validation.",
          code: "plan_blocked_invalid",
          stage: "plan_ready",
          data: { reasonCodes: planningResult.reasonCodes.join(",") },
          at: runtime.isoNow(),
        });
      }
    }
    runtime.emitStage(bus, runId, "plan_ready", "completed", [
      "plan_skipped",
    ]);
  }

  return { planText };
}
