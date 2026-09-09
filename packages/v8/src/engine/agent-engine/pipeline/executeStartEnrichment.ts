import type { ExecutionDecision } from "../../../modules/decision-policy";
import { toolGrantsEquivalent } from "../../../modules/decision-policy";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import {
  PLANNING_SCHEMA_VERSION,
  collectDiscoveryImpactSeedPaths,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
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
} from "../../../modules/prompt-construction";
import { deriveContextSelectionBudget } from "../../../modules/repository-context";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import {
  resolveFuzzyFileTargets,
  type RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import { SKILLS_SCHEMA_VERSION } from "../../../modules/skills";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import { resolveWindowBudgetBand } from "../../../modules/window-budget";

import {
  extractMemoryFileTargets,
  collectPlanningImpactReports,
  mapContextToPromptSlice,
  mapUnderstandingToPlanningEvidence,
  mapUnderstandingToSkillEvidence,
  extractMentionedPaths,
  buildPlanningQuery,
  buildScopedRepoMapForPlanning,
  collectPreferredPlanningPaths,
  extractPriorPathHints,
  toPlanningBuildEvidence,
  CONTEXT_READY_VERBOSE_WARNING_CODES,
  CONTEXT_READY_WARNING_CODES,
  deriveContextFocusFromUnderstanding,
  scopeDiscoveredContextPaths,
  recordDiscoveryEvidence,
  recordPlanEvidence,
  formatSkillPromptContent,
  buildSkillsReadyEvent,
} from "../actions";
import { applyPlanModeDiscoveryContract } from "../actions/planDiscoveryContract";
import {
  clarifyAfterInsufficientPlanDiscovery,
  isPlanDiscoveryEvidenceSufficient,
  requiresPlanDiscoveryQualityFloor,
} from "../actions/planDiscoveryQuality";
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
import { type TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import {
  capturePreflightBuildState,
  runDiscoveryPass,
} from "./pinAndDiscovery";
import { persistVerificationArtifact } from "./verification";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";

export type StartEnrichmentContinue = {
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  repositoryContext: PromptRepositoryContext | undefined;
  selectedSkills: PromptInstructions["skills"];
  selectedMemory: PromptInstructions["memory"];
  planText: string | undefined;
};

export type StartEnrichmentOutcome =
  | { kind: "terminal"; result: AgentRunResult }
  | { kind: "continue"; state: StartEnrichmentContinue };

/** Context → Skills → Memory → Planning. */
export async function runStartEnrichment(
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
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
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
    pinnedState?: RepositoryStateReference;
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  cancelledResult: () => Promise<AgentRunResult>;
}): Promise<StartEnrichmentOutcome> {
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
    candidateRelativePaths,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate,
    planSource,
    finish,
    cancelledResult,
  } = params;
  let { understanding, decision } = params;

  // --- Context ---
  let repositoryContext: PromptRepositoryContext | undefined;
  let contextPaths: string[] = [];

  if (decision.repositoryContextRequired) {
    if (!runtime.deps.repositoryContext || !shared.pinnedState) {
      reasonCodes.push("state_unavailable");
      await runtime.safeUnpin(runId, shared.pinnedState);
      return {
        kind: "terminal",
        result: finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "state_unavailable",
            message:
              "Repository context is required but state/context ports are unavailable.",
          },
        }),
      };
    }

    runtime.emitStage(bus, runId, "context_ready", "started");
    const contextQuery = extractPrimaryUserMessage(envelope.message);
    const contextFocus = deriveContextFocusFromUnderstanding(understanding);
    const contextResult = await runtime.deps.repositoryContext.execute({
      state: shared.pinnedState,
      query: contextQuery,
      mode: envelope.mode,
      selectionBudget: deriveContextSelectionBudget(
        runtime.deps.llm.capabilities.contextWindowTokens,
        { maximumTokens: windowPolicy.sections.repositoryTokens },
      ),
      ...(contextFocus.folderPrefix
        ? { folderPrefix: contextFocus.folderPrefix }
        : {}),
      ...(contextFocus.filePaths.length > 0
        ? { filePaths: contextFocus.filePaths }
        : {}),
      ...(contextFocus.kinds.length > 0
        ? { kinds: contextFocus.kinds }
        : {}),
      ...(contextFocus.references
        ? { references: contextFocus.references }
        : {}),
      abortSignal: signal,
    });

    if (signal.aborted || contextResult.status === "cancelled") {
      await runtime.safeUnpin(runId, shared.pinnedState);
      return { kind: "terminal", result: await cancelledResult() };
    }

    if (contextResult.status === "failed") {
      reasonCodes.push("context_failed");
      await runtime.safeUnpin(runId, shared.pinnedState);
      return {
        kind: "terminal",
        result: finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "context_failed",
            message: "Repository context retrieval failed.",
          },
        }),
      };
    }

    repositoryContext = mapContextToPromptSlice(contextResult);
    reasonCodes.push("context_retrieved");
    const discoveredPaths = contextResult.assembly.blocks
      .map((block) => block.relativePath)
      .filter((path): path is string => Boolean(path?.trim()));
    // Fuzzy-resolve basenames against retrieved paths (+ dirty/@ hints).
    if (discoveredPaths.length > 0) {
      const fuzzy = resolveFuzzyFileTargets(
        understanding.taskAnalysis.targets,
        [...candidateRelativePaths, ...discoveredPaths],
      );
      if (fuzzy.resolved.length > 0) {
        understanding = {
          ...understanding,
          taskAnalysis: {
            ...understanding.taskAnalysis,
            targets: fuzzy.targets,
          },
        };
      }
    }
    const scopedFocus = deriveContextFocusFromUnderstanding(understanding);
    contextPaths = scopeDiscoveredContextPaths(discoveredPaths, scopedFocus);
    runtime.emit(bus, {
      type: "context_ready",
      runId,
      stateToken: contextResult.stateToken,
      blockCount: contextResult.assembly.blocks.length,
      retrievedCandidates: contextResult.statistics.retrievedCandidates,
      selectedItems: contextResult.statistics.selectedItems,
      droppedBlocks: contextResult.statistics.droppedBlocks,
      status: contextResult.status,
      ...(contextPaths.length > 0 ? { paths: contextPaths } : {}),
      ...(contextResult.retrieval?.sourceReports &&
      contextResult.retrieval.sourceReports.length > 0
        ? {
            retrievalSources: contextResult.retrieval.sourceReports
              .slice(0, 8)
              .map((report) => ({
                sourceId: report.sourceId,
                status: report.status,
                candidateCount: report.candidateCount,
                ...(report.status === "failed" && report.error
                  ? { error: report.error.slice(0, 300) }
                  : {}),
              })),
          }
        : {}),
      at: runtime.isoNow(),
    });
    for (const warning of contextResult.warnings) {
      const standard = CONTEXT_READY_WARNING_CODES.has(warning.code);
      const verboseOnly = CONTEXT_READY_VERBOSE_WARNING_CODES.has(
        warning.code,
      );
      if (!standard && !verboseOnly) continue;
      if (!logVerbosityAtLeast(input.logVerbosity, standard ? "standard" : "verbose")) {
        continue;
      }
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: warning.message,
        code: warning.code,
        stage: "context_ready",
        at: runtime.isoNow(),
      });
    }
    runtime.emitStage(bus, runId, "context_ready", "completed", [
      "context_retrieved",
    ]);
  } else {
    reasonCodes.push("context_skipped");
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  if (runtime.deps.decision.narrow) {
    const narrowed = runtime.deps.decision.narrow({
      previous: decision,
      discoveredPaths: contextPaths,
      residualRisk: understanding.taskAnalysis.risk,
    });
    if (
      !toolGrantsEquivalent(decision.toolGrant, narrowed.toolGrant)
    ) {
      decision = narrowed;
      reasonCodes.push("grant_narrowed");
      runtime.emit(bus, {
        type: "grant_narrowed",
        runId,
        maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
        approvalMode: decision.toolGrant.approvalMode,
        pathScopes: decision.toolGrant.pathScopes.slice(0, 20),
        reasonCodes: decision.reasonCodes.slice(-8),
        truncated:
          decision.toolGrant.pathScopes.length > 20 ||
          decision.reasonCodes.length > 8
            ? true
            : undefined,
        at: runtime.isoNow(),
      });
    }
  }

  // Plan-mode repair-intent capture when early Agent preflight was skipped.
  if (!shared.repoBuildStateBefore) {
    shared.repoBuildStateBefore = await capturePreflightBuildState(runtime, {
      runId,
      decision,
      understanding,
      input,
      pinnedState: shared.pinnedState,
      contextPaths,
      bus,
      signal,
      reasonCodes,
      warnings,
      mentionedPaths: extractMentionedPaths(
        extractPrimaryUserMessage(envelope.message),
      ),
    });
    if (shared.repoBuildStateBefore) {
      runtime.emitRepoBuildStateCaptured(bus, runId, shared.repoBuildStateBefore);
      shared.verificationRecord =
        (await persistVerificationArtifact(runtime, {
          runId,
          requestId: shared.requestId,
          workspaceId: resolveWorkspaceId(input),
          bus,
          reasonCodes,
          warnings,
          status: "captured_before",
          before: shared.repoBuildStateBefore,
          previous: shared.verificationRecord,
          logVerbosity: input.logVerbosity,
        })) ?? shared.verificationRecord;
    }
  }

  // --- Skills (optional) ---
  let selectedSkills: PromptInstructions["skills"];
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
      forbidLargeSkills:
        resolveWindowBudgetBand(windowPolicy.contextWindowTokens) === "compact",
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
      ...(memoryFileTargets.length > 0
        ? { fileTargets: memoryFileTargets }
        : {}),
    });
    selectedMemory = memoryResult.instructions.map((block) => ({
      id: block.id,
      title: block.title,
      content: block.content,
      priority: block.priority,
    }));
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
    const planContract = applyPlanModeDiscoveryContract({
      mode: envelope.mode,
      explorationDepth: input.explorationDepth,
      query: planningInput.query,
      conversation: input.conversation ?? [],
      strategy: strategyDecision,
    });
    let strategyOverride: PlanStrategyDecision = planContract.strategy;
    if (planContract.applied) {
      reasonCodes.push("plan_mode_discovery_required");
    }
    let discoveryBrief = planningInput.discoveryBrief;
    const planQualityFloor = requiresPlanDiscoveryQualityFloor({
      mode: envelope.mode,
      explorationDepth: input.explorationDepth,
    });
    // Post-contract strategy (Plan mode may upgrade to discover_and_plan).
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
        !isPlanDiscoveryEvidenceSufficient(discovery.brief)
      ) {
        reasonCodes.push("plan_mode_discovery_insufficient");
        strategyOverride = clarifyAfterInsufficientPlanDiscovery(
          strategyOverride.confidence,
        );
      }
    }

    let impactReports = planningInput.impactReports;
    const impactSeedPaths =
      strategyOverride.strategy === "follow_evidence"
        ? (planningInput.buildEvidence?.diagnostics ?? [])
            .filter((diagnostic) => diagnostic.severity === "error")
            .map((diagnostic) => diagnostic.path)
        : strategyOverride.strategy === "discover_and_plan" && discoveryBrief
          ? collectDiscoveryImpactSeedPaths(discoveryBrief)
          : [];
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
      selectedMemory,
      planText,
    },
  };
}
