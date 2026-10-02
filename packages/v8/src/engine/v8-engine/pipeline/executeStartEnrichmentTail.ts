import type { ExecutionDecision } from "../../../modules/decision-policy";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import {
  PLANNING_SCHEMA_VERSION,
  collectDiscoveryImpactSeedPaths,
  collectPlanningImpactReports,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
  mapUnderstandingToPlanningEvidence,
  planningInputSchema,
  resolvePlanStrategyRules,
  serializePlanForPrompt,
  type PlanArtifact,
  type PlanStrategyDecision,
  type PlanningInput,
} from "../../../modules/planning";
import type {
  PromptInstructions,
  PromptRepositoryContext,
  PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import {
  SKILLS_SCHEMA_VERSION,
  formatSkillPromptContent,
  mapUnderstandingToSkillEvidence,
} from "../../../modules/skills";
import type { WindowPolicy } from "../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../modules/window-budget";

import {
  extractMemoryFileTargets,
  buildPlanningQuery,
  buildScopedRepoMapForPlanning,
  collectPreferredPlanningPaths,
  extractPriorPathHints,
  toPlanningBuildEvidence,
  recordDiscoveryEvidence,
  recordPlanEvidence,
  buildSkillsReadyEvent,
} from "../actions";
import {
  applyPlanModeDiscoveryContract,
  isAgentWidePlanningScope,
  clarifyAfterInsufficientPlanDiscovery,
  isPlanDiscoveryEvidenceSufficient,
  requiresPlanDiscoveryQualityFloor,
  usesThoroughPlanDiscoveryEvidence,
} from "../modules/plan-discovery";
import { applyExecutionSeedToTaskList } from "../modules/execution-seed";
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
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
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
  let selectedSkills: PromptInstructions["skills"];
  let skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
  const injectSkillCatalogL1 =
    resolveSteeringFeatureFlags(input.steering).injectSkillCatalogL1 === true;
  if (runtime.deps.skills) {
    runtime.emitStage(bus, runId, "skills_ready", "started");
    const understandingSkillEvidence = mapUnderstandingToSkillEvidence(
      understanding,
      {
        projects: input.projects,
        extraPaths: [...(input.dirtyPaths ?? []), ...contextPaths],
      },
    );
    const skillEvidencePaths = [
      ...new Set(understandingSkillEvidence.paths),
    ]
      .filter((path) => path.trim().length > 0)
      .slice(0, 50);
    const skillsResult = await runtime.deps.skills.select({
      schemaVersion: SKILLS_SCHEMA_VERSION,
      query: extractPrimaryUserMessage(envelope.message),
      mode: envelope.mode,
      route: decision.route,
      budgetTokens: windowPolicy.skills.budgetTokens,
      maxSkills: windowPolicy.skills.maxSkills,
      requiredSkillIds: input.requiredSkillIds ?? [],
      excludedSkillIds: input.excludedSkillIds ?? [],
      forbidLargeSkills:
        resolveWindowBudgetBand(windowPolicy.contextWindowTokens) === "compact",
      includeCatalogL1: injectSkillCatalogL1,
      evidence: {
        ...understandingSkillEvidence,
        paths: skillEvidencePaths,
      },
    });
    selectedSkills = skillsResult.instructions.map((block) => ({
      id: block.id,
      title: block.title,
      content: formatSkillPromptContent(block),
      priority: block.priority,
    }));
    if (
      injectSkillCatalogL1 &&
      skillsResult.catalogL1 &&
      skillsResult.catalogL1.length > 0
    ) {
      skillCatalogL1 = skillsResult.catalogL1;
    }
    if (skillsResult.warnings.length > 0 && logVerbosityAtLeast(input.logVerbosity, "verbose")) {
      warnings.push(...skillsResult.warnings);
    }
    reasonCodes.push(
      skillsResult.instructions.length > 0
        ? "skills_selected"
        : "skills_skipped",
    );
    runtime.emit(
      bus,
      buildSkillsReadyEvent({
        runId,
        skillsResult,
        at: runtime.isoNow(),
      }),
    );
    runtime.emitStage(bus, runId, "skills_ready", "completed", [
      skillsResult.instructions.length > 0
        ? "skills_selected"
        : "skills_skipped",
    ]);
  } else {
    reasonCodes.push("skills_skipped");
  }

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
    if (planSource === "host_carry") {
      reasonCodes.push("plan_drafted", "plan_carried");
    } else {
      reasonCodes.push("plan_drafted", "plan_approved");
    }
  } else if (runtime.deps.planning && decision.planningDepth !== "none") {
    runtime.emitStage(bus, runId, "plan_ready", "started");
    const contextReviewed = (repositoryContext?.blocks ?? [])
      .slice(0, 20)
      .map((block) => ({
        kind: "file" as const,
        ref: block.relativePath,
      }));
    const planningEvidence = mapUnderstandingToPlanningEvidence(understanding);
    const priorPathHints = extractPriorPathHints(input.conversation);
    const knownPathHints = collectPreferredPlanningPaths({
      evidenceTargets: planningEvidence.targets,
      contextPaths,
      priorPathHints,
      seedPaths: shared.executionSeed?.paths,
      query: buildPlanningQuery(
        extractPrimaryUserMessage(envelope.message),
        input.conversation,
      ),
    });
    const planningInputCandidate: PlanningInput = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      query: buildPlanningQuery(
        extractPrimaryUserMessage(envelope.message),
        input.conversation,
      ),
      mode: envelope.mode,
      route: decision.route,
      planningDepth: decision.planningDepth,
      explorationDepth: input.explorationDepth,
      evidence: planningEvidence,
      scopedRepoMap: buildScopedRepoMapForPlanning(contextPaths),
      buildEvidence: shared.repoBuildStateBefore
        ? toPlanningBuildEvidence(shared.repoBuildStateBefore)
        : undefined,
      skills: selectedSkills?.map((block) => ({
        id: block.id,
        title: block.title,
        content: block.content,
        priority: block.priority,
      })),
      processHints: [],
      contextReviewed:
        contextReviewed.length > 0 ? contextReviewed : undefined,
      ...(knownPathHints.length > 0 ? { knownPathHints } : {}),
      budgetTokens: windowPolicy.planning.budgetTokens,
      maxDiagnosticSteps: windowPolicy.planning.maxDiagnosticSteps,
      maxFilesPerBatch: windowPolicy.mutation.preferredBatchSize,
    };
    const planningInput = planningInputSchema.parse(planningInputCandidate);

    // Engine owns strategy (rules only); Planning drafts against override.
    const strategyDecision = resolvePlanStrategyRules(planningInput);
    const agentWideScope = isAgentWidePlanningScope(planningInput.evidence);
    const taskSize = planningInput.evidence.taskSize;
    const mediumOrLarge =
      taskSize === "medium" || taskSize === "large";
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
        envelope.mode === "agent"
          ? "agent_big_task_discovery_required"
          : "plan_mode_discovery_required",
      );
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
        preferredPaths: knownPathHints,
        qualityFloor: planQualityFloor,
        thoroughEvidence,
        seedFirstDiscovery: mediumOrLarge,
        preferSymbols: mediumOrLarge,
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
      if (
        planQualityFloor &&
        !isPlanDiscoveryEvidenceSufficient(discovery.brief, {
          thorough: thoroughEvidence,
        })
      ) {
        reasonCodes.push("plan_mode_discovery_insufficient");
        strategyOverride = clarifyAfterInsufficientPlanDiscovery(
          strategyOverride.confidence,
          { thorough: thoroughEvidence },
        );
      }
    }

    let impactReports = planningInput.impactReports;
    const impactSeedPaths =
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
    if (impactSeedPaths.length > 0) {
      impactReports = await collectPlanningImpactReports({
        repoGraphs: runtime.deps.repoGraphs,
        seedPaths: impactSeedPaths,
      });
    }

    const planningResult = await runtime.deps.planning.plan({
      ...planningInput,
      discoveryBrief,
      strategyOverride,
      ...(impactReports && impactReports.length > 0
        ? { impactReports }
        : {}),
    });

    if (planningResult.plan) {
      shared.runPlan = planningResult.plan;
      shared.runPlanStrategy = planningResult.strategy;
      recordPlanEvidence(runEvidence, planningResult.plan);
      planText = serializePlanForPrompt(
        planningResult.plan,
        planningResult.strategy,
      );
      reasonCodes.push("plan_drafted");
      runtime.emit(bus, {
        type: "plan_ready",
        runId,
        planningDepth: decision.planningDepth,
        phaseCount: planningResult.plan.phases.length,
        approvalRequired: planningResult.plan.approvalRequired,
        plan: planningResult.plan,
        at: runtime.isoNow(),
      });
      runtime.emitEvidenceUpdated(bus, runId, runEvidence);
      runtime.emitStage(bus, runId, "plan_ready", "completed", [
        "plan_drafted",
      ]);
      syncTaskListOnce();
      const seededAfterPlan = applyExecutionSeedToTaskList({
        taskList: taskListRef.current,
        seed: shared.executionSeed,
      });
      if (seededAfterPlan.applied && seededAfterPlan.taskList) {
        taskListRef.current = seededAfterPlan.taskList;
        reasonCodes.push("execution_seed_task_list_bound");
      }

      if (
        !skipPlanGate &&
        decision.planGate === "required_before_execute"
      ) {
        reasonCodes.push("plan_approval_suspended");
        const rationale =
          "A reviewable plan is required before mutation. Approve, edit, or reject the plan to continue.";
        if (runtime.deps.checkpointStore) {
          await runtime.deps.checkpointStore.save({
            runId,
            requestId: shared.requestId,
            suspensionKind: "plan_approval_required",
            input,
            decision,
            pinnedState: shared.pinnedState,
            messages: [],
            toolCacheEntries: [],
            pendingApproval: undefined,
            plan: planningResult.plan,
            ...(planningResult.strategy
              ? { planStrategy: planningResult.strategy }
              : {}),
            changedFiles: [],
            mutationCheckpointIds: [],
            reasonCodes,
            warnings,
            usage: budget.snapshot(),
            startedAtMs: startedMs,
            repoBuildStateBefore: shared.repoBuildStateBefore,
            repoBuildStateAfter: shared.repoBuildStateAfter,
            ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
            ...(taskListRef.completedPlanStepIds &&
            taskListRef.completedPlanStepIds.length > 0
              ? {
                  completedPlanStepIds: [
                    ...taskListRef.completedPlanStepIds,
                  ],
                }
              : {}),
          });
        }
        runtime.emit(bus, {
          type: "suspended",
          runId,
          kind: "plan_approval_required",
          rationale,
          at: runtime.isoNow(),
        });
        return {
          kind: "terminal",
          result: finish({
            status: "suspended",
            route: decision.route,
            planningDepth: decision.planningDepth,
            plan: planningResult.plan,
            answer: formatPlanAsAnswer(planningResult.plan),
            suspension: {
              kind: "plan_approval_required",
              rationale,
              plan: planningResult.plan,
            },
            reasonCodes,
          }),
        };
      }

      // Plan mode: structured plan is the terminal answer (skip model loop).
      if (envelope.mode === "plan") {
        reasonCodes.push("plan_mode_completed", "answer_produced");
        await runtime.safeUnpin(runId, shared.pinnedState);
        return {
          kind: "terminal",
          result: finish({
            status: "completed",
            route: decision.route,
            planningDepth: decision.planningDepth,
            plan: planningResult.plan,
            answer: formatPlanAsAnswer(planningResult.plan),
            reasonCodes,
          }),
        };
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
