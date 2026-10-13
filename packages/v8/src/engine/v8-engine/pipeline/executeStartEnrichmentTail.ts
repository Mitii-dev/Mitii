import type { ExecutionDecision } from "../../../modules/decision-policy";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import {
  askNeedsPlanScopeFork,
  collectDiscoveryImpactSeedPaths,
  collectPlanningImpactReports,
  inferPlanStrategyFromArtifact,
  resolvePlanStrategyRules,
  serializePlanForPrompt,
  thinDiscoveryBriefForClarify,
  type PlanArtifact,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type {
  PromptInstructions,
  PromptRepositoryContext,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  extractMemoryFileTargets,
  recordDiscoveryEvidence,
  recordPlanEvidence,
  selectSkillsForEnrichment,
} from "../actions";
import { preparePlanningInputFromEnrichment } from "./preparePlanningInputFromEnrichment";
import { runPostPlanDraftGates } from "./enrichmentAfterPlanDraft";
import {
  applyPlanModeDiscoveryContract,
  applyPlanScopePhaseBounds,
  boundImpactSeedsForPlanScope,
  clarifyAfterInsufficientPlanDiscovery,
  isAgentWidePlanningScope,
  requiresPlanDiscoveryQualityFloor,
  shouldClarifyAfterPlanDiscovery,
  usesThoroughPlanDiscoveryEvidence,
} from "../modules/plan-discovery";
import {
  applyExecutionSeedToTaskList,
  isExecutionSeedTrusted,
  refineExecutionSeedFromPlan,
} from "../modules/execution-seed";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { runDiscoveryPass } from "./pinAndDiscovery";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
export async function finishEnrichmentSkillsMemoryPlan(
  runtime: AgentEngineRuntime,
  params: {
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
    approvedPlan?: PlanArtifact;
    approvedPlanStrategy?: PlanStrategyDecision;
    skipPlanGate: boolean;
    planSource?: "host_carry" | "resume_approval";
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
    cancelledResult: () => Promise<AgentRunResult>;
    understanding: RequestUnderstandingResult;
    decision: ExecutionDecision;
    repositoryContext: PromptRepositoryContext | undefined;
    contextPaths: string[];
  },
): Promise<StartEnrichmentOutcome> {
  const {
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
    candidateRelativePaths: _candidateRelativePaths,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate,
    planSource,
    finish,
    cancelledResult,
    repositoryContext,
    contextPaths,
  } = params;
  let { understanding, decision } = params;

  // --- Skills (optional) ---
  const { selectedSkills, skillCatalogL1 } = await selectSkillsForEnrichment({
    runtime,
    runId,
    input,
    bus,
    windowPolicy,
    reasonCodes,
    warnings,
    envelope,
    understanding,
    decision,
    contextPaths,
  });

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Memory (optional) ---
  let selectedMemory: PromptInstructions["memory"];
  const workspaceId = envelope.workspace?.workspaceId;
  if (runtime.deps.memory && workspaceId) {
    runtime.emitStage(bus, runId, "memory_ready", "started");
    const memoryFileTargets = extractMemoryFileTargets(understanding);
    const memoryResult = await runtime.deps.memory.retrieve({
      schemaVersion: MEMORY_SCHEMA_VERSION,
      query: extractPrimaryUserMessage(envelope.message),
      scope: { kind: "workspace", workspaceId },
      now: runtime.isoNow(),
      mode: "default",
      deferAccess: true,
      signal,
      origin: envelope.origin === "user" ? "user" : "automation",
      ...(memoryFileTargets.length > 0
        ? { fileTargets: memoryFileTargets }
        : {}),
    });
    const layered = memoryResult.layers;
    selectedMemory = (
      layered
        ? [
            ...layered.l1Index,
            ...layered.l2Timeline,
            ...layered.l3Facts,
          ]
        : memoryResult.instructions
    ).map((block) => ({
      id: block.id,
      title: block.title,
      content: block.content,
      priority: block.priority,
      memoryProvenance: block.provenance,
    }));
    warnings.push(...memoryResult.warnings);
    reasonCodes.push(
      memoryResult.instructions.length > 0
        ? "memory_retrieved"
        : memoryResult.status === "empty"
          ? "memory_empty"
          : "memory_skipped",
    );
    runtime.emit(bus, {
      type: "memory_ready",
      runId,
      selectedCount: memoryResult.instructions.length,
      omittedCount: memoryResult.omissions.length,
      status: memoryResult.status,
      at: runtime.isoNow(),
    });
    runtime.emitStage(bus, runId, "memory_ready", "completed", [
      memoryResult.instructions.length > 0
        ? "memory_retrieved"
        : memoryResult.status === "empty"
          ? "memory_empty"
          : "memory_skipped",
    ]);
  } else {
    reasonCodes.push("memory_skipped");
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  // --- Planning (optional) ---
  let planText: string | undefined;
  if (approvedPlan) {
    shared.runPlan = approvedPlan;
    shared.runPlanStrategy =
      approvedPlanStrategy ?? inferPlanStrategyFromArtifact(approvedPlan);
    planText = serializePlanForPrompt(approvedPlan, shared.runPlanStrategy);
    recordPlanEvidence(runEvidence, approvedPlan);
    runtime.emitEvidenceUpdated(bus, runId, runEvidence);
    // Resume-from-approval restarts start — promote plan paths so mutate
    // lock is not stuck on the pre-plan weak seed from a pathless prompt.
    const promoted = refineExecutionSeedFromPlan({
      seed: shared.executionSeed,
      plan: approvedPlan,
    });
    if (isExecutionSeedTrusted(promoted)) {
      if (
        !shared.executionSeed ||
        shared.executionSeed.confidence !== "trusted" ||
        promoted.paths.join("\0") !== shared.executionSeed.paths.join("\0")
      ) {
        shared.executionSeed = promoted;
        reasonCodes.push("execution_seed_from_plan");
      }
    }
    if (planSource === "host_carry") {
      reasonCodes.push("plan_drafted", "plan_carried");
    } else {
      reasonCodes.push("plan_drafted", "plan_approved");
    }
  } else if (runtime.deps.planning && decision.planningDepth !== "none") {
    runtime.emitStage(bus, runId, "plan_ready", "started");
    const {
      planningInput: preparedPlanningInput,
      knownPathHints,
    } = preparePlanningInputFromEnrichment({
      envelope,
      understanding,
      conversation: input.conversation ?? [],
      contextPaths,
      repositoryContext,
      selectedSkills,
      shared,
      windowPolicy,
      route: decision.route,
      planningDepth: decision.planningDepth,
      explorationDepth: input.explorationDepth,
      reasonCodes,
    });
    let planningInput = preparedPlanningInput;

    // Engine owns strategy (rules only); Planning drafts against override.
    const strategyDecision = resolvePlanStrategyRules(planningInput);
    const agentWideScope = isAgentWidePlanningScope(planningInput.evidence);
    const taskSize = planningInput.evidence.taskSize;
    const mediumOrLarge =
      taskSize === "medium" || taskSize === "large";
    const scopePhase = applyPlanScopePhaseBounds({
      planningInput,
      knownPathHints,
      scopeChoice: {
        query: planningInput.query,
        conversation: input.conversation ?? [],
        optionId: input.clarificationResolution?.optionId,
        outcomeNote: input.clarificationResolution?.outcomeNote,
        label: input.clarificationResolution?.label,
      },
      taskSize,
      contextWindowTokens: windowPolicy.contextWindowTokens,
      reasonCodes,
    });
    planningInput = scopePhase.planningInput;
    const {
      resolvedScopeId,
      scopeChoiceResolved,
      discoveryPreferredPaths,
      discoveryBudgetOverride,
      discoveryScopeHint,
    } = scopePhase;
    if (scopePhase.nextPlanPhaseOffer) {
      shared.nextPlanPhaseOffer = scopePhase.nextPlanPhaseOffer;
    }
    const planContract = applyPlanModeDiscoveryContract({
      mode: envelope.mode,
      explorationDepth: input.explorationDepth,
      query: planningInput.query,
      conversation: input.conversation ?? [],
      strategy: strategyDecision,
      planningDepth: decision.planningDepth,
      agentWideScope,
      taskSize,
    });
    let strategyOverride: PlanStrategyDecision = planContract.strategy;
    if (planContract.applied) {
      reasonCodes.push(
        planContract.rationale === "plan_scope_choice_honored"
          ? "plan_scope_choice_honored"
          : envelope.mode === "agent"
            ? "agent_big_task_discovery_required"
            : "plan_mode_discovery_required",
      );
    } else if (
      scopeChoiceResolved &&
      !reasonCodes.includes("plan_scope_choice_honored")
    ) {
      reasonCodes.push("plan_scope_choice_honored");
    }
    let discoveryBrief = planningInput.discoveryBrief;
    const thoroughEvidence = usesThoroughPlanDiscoveryEvidence({
      mode: envelope.mode,
      planningDepth: decision.planningDepth,
    });
    const planQualityFloor = requiresPlanDiscoveryQualityFloor({
      mode: envelope.mode,
      explorationDepth: input.explorationDepth,
      planningDepth: decision.planningDepth,
      agentWideScope,
      taskSize,
    });
    // Post-contract strategy (Plan / Agent big-task may upgrade to discover_and_plan).
    if (strategyOverride.strategy === "discover_and_plan") {
      const discovery = await runDiscoveryPass(runtime, {
        runId,
        query: planningInput.query,
        objective:
          planningInput.evidence.requestedOutcomes?.[0] ??
          planningInput.query,
        evidence: planningInput.evidence,
        decision,
        pinnedState: shared.pinnedState,
        workspaceRoot: input.workspaceRoot,
        bus,
        signal,
        budget,
        reasonCodes,
        warnings,
        taskListRef,
        windowPolicy,
        preferredPaths: discoveryPreferredPaths,
        qualityFloor: planQualityFloor,
        thoroughEvidence,
        seedFirstDiscovery: mediumOrLarge,
        preferSymbols: mediumOrLarge,
        // Thorough Plan / Agent-visible: keep searching even when a preferred path is known.
        forceExploration: thoroughEvidence,
        taskSize,
        ...(discoveryBudgetOverride
          ? { discoveryBudgetOverride }
          : {}),
        ...(discoveryScopeHint ? { discoveryScopeHint } : {}),
      });
      discoveryBrief = discovery.brief;
      recordDiscoveryEvidence(runEvidence, {
        brief: discovery.brief,
        collector: discovery.collector,
        failed: discovery.failed,
      });
      runtime.emitEvidenceUpdated(bus, runId, runEvidence);
      // Discovery ran; skip Planning's Discover phase.
      strategyOverride = { ...strategyOverride, skipDiscover: true };
      // Use the discovery pass failure flag — never recompute with weaker options.
      // Clear single-outcome asks (and already-chosen A/B/C) draft from evidence
      // instead of forcing harness A/B/C chips.
      if (
        shouldClarifyAfterPlanDiscovery({
          qualityFloor: planQualityFloor,
          discoveryFailed: discovery.failed,
        })
      ) {
        const needsScopeFork = askNeedsPlanScopeFork({
          clarity: planningInput.evidence.clarity,
          primaryIntent: planningInput.evidence.primaryIntent,
          requestedOutcomes: planningInput.evidence.requestedOutcomes,
          query: planningInput.query,
        });
        if (scopeChoiceResolved || !needsScopeFork) {
          if (scopeChoiceResolved && !reasonCodes.includes("plan_scope_choice_honored")) {
            reasonCodes.push("plan_scope_choice_honored");
          }
          warnings.push(
            scopeChoiceResolved
              ? "Discovery quality floor was not fully met, but a plan scope choice was already resolved — drafting a concrete plan from available evidence."
              : "Discovery quality floor was not fully met, but the ask is a clear single outcome — drafting a concrete plan from available evidence (no A/B/C fork).",
          );
        } else {
          reasonCodes.push("plan_mode_discovery_insufficient");
          strategyOverride = clarifyAfterInsufficientPlanDiscovery(
            strategyOverride.confidence,
            { thorough: thoroughEvidence },
          );
          // Strip seed-read surfaces so Planning cannot draft Change skeletons.
          discoveryBrief = thinDiscoveryBriefForClarify(discoveryBrief);
        }
      }
    }

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

    let planningResult = await runtime.deps.planning.plan({
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
      planningResult = await runtime.deps.planning.plan({
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
        return postPlan.terminal;
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
  } else {
    reasonCodes.push("plan_skipped");
  }

  syncTaskListOnce();
  const seededTaskList = applyExecutionSeedToTaskList({
    taskList: taskListRef.current,
    seed: shared.executionSeed,
  });
  if (seededTaskList.applied && seededTaskList.taskList) {
    taskListRef.current = seededTaskList.taskList;
    reasonCodes.push("execution_seed_task_list_bound");
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  return {
    kind: "continue",
    state: {
      envelope,
      understanding,
      decision,
      repositoryContext,
      selectedSkills,
      skillCatalogL1,
      selectedMemory,
      planText,
    },
  };
}
