import type { ModelMessage } from "../../../modules/model-gateway";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  mergePromptInstructions,
  type PromptInstructions,
} from "../../../modules/prompt-construction";
import {
  compileDecisionBrief,
  formatDecisionBriefForPrompt,
} from "../../../modules/decision-policy";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import {
  annotateMutationToolDefinitions,
  applyExplorationSignal,
  buildInstructionBodies,
  clampRunBudget,
  toRunUsage,
  createInitialRunEvidence,
  extractMemoryFileTargets,
  finalizeRunEvidence,
  formatExecutionSeedForPrompt,
  isProviderInfrastructureFailure,
} from "../actions";
import { filterToolDefinitions } from "../actions/filterToolDefinitions";
import { withMcpAttachOnGrant, formatMcpAttachInstruction } from "../../../modules/mcp-attach";
import type { EstablishedFact } from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../legacy/constants";
import { agentRunBudgetSchema } from "../contracts";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import { finishAfterLoop, persistVerificationArtifact } from "./verification";
import {
  runStartEarlyPipeline,
  type ExecuteStartSharedState,
} from "./executeStartEarlyPipeline";
import { runStartEnrichment } from "./executeStartEnrichment";

import { warnPreflightRepairLock } from "./warnPreflightRepairLock";
import { emitPromptReady } from "./emitPromptReady";
import { runV8ModelLoop } from "./modelLoop";
import { parseAgentRunResultResilient } from "./parseAgentRunResult";
import type { StartReuseState } from "./startReuse";
import { emitRunBudgetClampWarnings } from "./emitRunBudgetClampWarnings";

/**
 * V8 start path: early + enrichment (legacy modules) → thin model/tool loop.
 * Never arms mutation-lock / preflight-repair steering into the loop.
 */
export async function executeV8Start(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    input: AgentEngineStartInput;
    bus: EventBus;
    signal: AbortSignal;
    getCancelReason: () => string | undefined;
    approvedPlan?: PlanArtifact;
    approvedPlanStrategy?: PlanStrategyDecision;
    skipPlanGate?: boolean;
    planSource?: "host_carry" | "resume_approval";
    reuse?: StartReuseState;
  },
): Promise<AgentRunResult> {
  const {
    runId,
    input,
    bus,
    signal,
    getCancelReason,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate = false,
    planSource,
    reuse,
  } = params;
  const startedMs = Date.now();
  const windowPolicy = runtime.resolveWindowPolicy(input);
  const runBudgetClamp = clampRunBudget(
    agentRunBudgetSchema.parse(input.budget ?? {}),
    windowPolicy,
  );
  const budget = new RunBudgetTracker(runBudgetClamp.budget, startedMs);
  const reasonCodes: AgentReasonCode[] = ["run_started"];
  const warnings: string[] = [];

  emitRunBudgetClampWarnings(runtime, {
    runId,
    bus,
    clamped: runBudgetClamp.clamped,
    logVerbosity: input.logVerbosity,
  });

  const shared: ExecuteStartSharedState = {
    pinnedState: undefined,
    requestId: input.request.requestId ?? runId,
    route: undefined,
    planningDepth: undefined,
    runPlan: undefined,
    runPlanStrategy: undefined,
    repoBuildStateBefore: undefined,
    repoBuildStateAfter: undefined,
    verificationRecord: undefined,
  };
  const runEvidence = createInitialRunEvidence(input.request.userMessage);
  const taskListRef: TaskListRef = {
    current:
      input.request.mode === "ask" || planSource === "resume_approval"
        ? undefined
        : input.taskList,
    maxTasks: windowPolicy.taskList.maxTasks,
    completedPlanStepIds: [],
  };
  let taskListSynced = false;
  const syncTaskListOnce = () => {
    const replacingDiscovery =
      taskListRef.current?.purpose === "discovery" ||
      taskListRef.current?.source === "discovery";
    if (taskListSynced && !replacingDiscovery) return;
    taskListSynced = true;
    runtime.syncTaskList({
      mode: input.request.mode,
      plan: shared.runPlan,
      planningDepth: shared.planningDepth,
      planSource,
      taskListRef,
      runId,
      bus,
      reasonCodes,
      resetExisting: planSource === "resume_approval" || replacingDiscovery,
    });
  };

  const finish = (
    partial: Omit<
      AgentRunResult,
      | "schemaVersion"
      | "runId"
      | "requestId"
      | "usage"
      | "durationMs"
      | "warnings"
      | "reasonCodes"
    > & {
      reasonCodes?: AgentReasonCode[];
      warnings?: string[];
    },
  ): AgentRunResult => {
    const usageSnap = budget.snapshot();
    const finalReasonCodes = [...(partial.reasonCodes ?? reasonCodes)];
    const finalWarnings = [...warnings, ...(partial.warnings ?? [])];
    applyExplorationSignal(usageSnap, finalReasonCodes, finalWarnings);
    const result = parseAgentRunResultResilient({
      schemaVersion: AGENT_ENGINE_SCHEMA_VERSION,
      runId,
      requestId: shared.requestId,
      status: partial.status,
      route: partial.route ?? shared.route,
      planningDepth: partial.planningDepth ?? shared.planningDepth,
      answer: partial.answer,
      plan: partial.plan ?? shared.runPlan,
      ...(partial.planStrategy ?? shared.runPlanStrategy
        ? { planStrategy: partial.planStrategy ?? shared.runPlanStrategy }
        : {}),
      ...(input.request.mode !== "ask" &&
      (partial.taskList ?? taskListRef.current)
        ? { taskList: partial.taskList ?? taskListRef.current }
        : {}),
      repoBuildStateBefore: shared.repoBuildStateBefore,
      repoBuildStateAfter: shared.repoBuildStateAfter,
      ...(shared.verificationRecord
        ? { verificationRecord: shared.verificationRecord }
        : {}),
      evidence: finalizeRunEvidence({
        evidence: runEvidence,
        status: partial.status,
        reasonCodes: finalReasonCodes,
      }),
      suspension: partial.suspension,
      pinnedState: partial.pinnedState ?? shared.pinnedState,
      ...(partial.sessionControl
        ? { sessionControl: partial.sessionControl }
        : {}),
      reasonCodes: finalReasonCodes,
      warnings: finalWarnings,
      usage: toRunUsage(usageSnap),
      durationMs: Date.now() - startedMs,
      error: partial.error,
    });

    runtime.emit(bus, {
      type: "terminal",
      runId,
      status: result.status,
      result,
      at: runtime.isoNow(),
    });
    return result;
  };

  const cancelledResult = async (): Promise<AgentRunResult> => {
    shared.verificationRecord =
      (await persistVerificationArtifact(runtime, {
        runId,
        requestId: shared.requestId,
        workspaceId: resolveWorkspaceId(input),
        bus,
        reasonCodes,
        warnings,
        status: "cancelled",
        before: shared.repoBuildStateBefore,
        after: shared.repoBuildStateAfter,
        previous: shared.verificationRecord,
        logVerbosity: input.logVerbosity,
      })) ?? shared.verificationRecord;
    return finish({
      status: "cancelled",
      reasonCodes: [...reasonCodes, "cancelled"],
      error: {
        code: "cancelled",
        message: getCancelReason() ?? "Run cancelled.",
      },
    });
  };

  try {
    if (signal.aborted) {
      return await cancelledResult();
    }

    const early = await runStartEarlyPipeline(runtime, {
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
      finish,
      cancelledResult,
      reuse,
    });
    if (early.kind === "terminal") {
      return early.result;
    }

    const enrichment = await runStartEnrichment(runtime, {
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
      envelope: early.state.envelope,
      understanding: early.state.understanding,
      decision: early.state.decision,
      candidateRelativePaths: early.state.candidateRelativePaths,
      approvedPlan,
      approvedPlanStrategy,
      skipPlanGate,
      planSource,
      finish,
      cancelledResult,
    });
    if (enrichment.kind === "terminal") {
      return enrichment.result;
    }

    const {
      envelope,
      understanding,
      decision,
      repositoryContext,
      selectedSkills,
      skillCatalogL1,
      selectedMemory,
      planText,
    } = enrichment.state;

    const attachIds = input.requiredMcpServerIds ?? [];
    const toolGrant = withMcpAttachOnGrant(decision.toolGrant, attachIds);
    const decisionWithAttach = { ...decision, toolGrant };
    const tools = annotateMutationToolDefinitions(
      attachTaskListTool({
        mode: envelope.mode,
        tools: filterToolDefinitions({
          grant: toolGrant,
          definitions:
            input.tools ??
            runtime.deps.toolDefinitions ??
            DEFAULT_TOOL_DEFINITIONS,
          supportsTools: runtime.deps.llm.capabilities.supportsTools,
          mode: envelope.mode,
          requiredMcpServerIds: attachIds,
        }),
      }),
      toolGrant.mutationBudget,
    );

    const projectRules = [...(input.instructions?.projectRules ?? [])];
    const mcpAttachRule = formatMcpAttachInstruction(attachIds);
    if (mcpAttachRule) {
      projectRules.push(mcpAttachRule);
    }
    const hostInstructions: PromptInstructions | undefined =
      projectRules.length > 0
        ? { ...input.instructions, projectRules }
        : input.instructions;

    const instructions = mergePromptInstructions({
      host: hostInstructions,
      skills: selectedSkills,
      memory: selectedMemory,
    });

    if (
      envelope.attachments &&
      envelope.attachments.length > 0 &&
      !runtime.deps.llm.capabilities.supportsVision
    ) {
      reasonCodes.push("vision_unsupported");
      await runtime.safeUnpin(runId, shared.pinnedState);
      return finish({
        status: "failed",
        reasonCodes,
        error: {
          code: "vision_unsupported",
          message: `Model ${runtime.deps.llm.capabilities.modelId} does not support image input.`,
        },
      });
    }

    const steering = resolveSteeringFeatureFlags(input.steering);
    const decisionBriefText = steering.decisionBrief
      ? formatDecisionBriefForPrompt(
          compileDecisionBrief({
            decision: decisionWithAttach,
            understanding,
          }),
        )
      : undefined;
    const executionSeedText =
      decisionWithAttach.toolGrant.maximumWorkspaceEffect === "write"
        ? formatExecutionSeedForPrompt(shared.executionSeed)
        : "";

    const promptResult = runtime.deps.prompt.construct({
      schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
      decision: decisionWithAttach,
      userMessage: envelope.message,
      attachments: envelope.attachments,
      conversation: input.conversation,
      repositoryContext,
      instructions,
      planText,
      ...(decisionBriefText ? { decisionBriefText } : {}),
      ...(executionSeedText ? { executionSeedText } : {}),
      injectSkillCatalogL1: steering.injectSkillCatalogL1,
      ...(steering.injectSkillCatalogL1 && skillCatalogL1
        ? { skillCatalogL1: [...skillCatalogL1] }
        : {}),
      tools,
      capabilities: runtime.deps.llm.capabilities,
      model: input.model,
      temperature: input.temperature,
      stream: input.stream,
      outputReserveTokens: windowPolicy.maximumOutputTokens,
      planBudgetTokens: planText ? windowPolicy.sections.planTokens : 0,
      fragmentLimits: {
        absoluteMaxTokens: windowPolicy.fragments.absoluteMaxTokens,
        reviewThresholdTokens: windowPolicy.fragments.reviewThresholdTokens,
        additionalContextValueTokens:
          windowPolicy.fragments.additionalContextValueTokens,
        skillCatalogL1MaxTokens: windowPolicy.fragments.skillCatalogL1MaxTokens,
        skillCatalogL1MaxEntries:
          windowPolicy.fragments.skillCatalogL1MaxEntries,
      },
    });

    if (promptResult.status === "blocked") {
      reasonCodes.push("prompt_blocked");
      await runtime.safeUnpin(runId, shared.pinnedState);
      return finish({
        status: "failed",
        reasonCodes,
        warnings: promptResult.warnings,
        error: {
          code: "prompt_blocked",
          message: "Prompt construction blocked the request.",
        },
      });
    }

    reasonCodes.push("prompt_constructed");
    if (promptResult.warnings.length > 0) {
      warnings.push(...promptResult.warnings);
    }

    emitPromptReady(runtime, {
      runId,
      bus,
      promptResult,
      windowPolicy,
      logVerbosity: input.logVerbosity,
    });

    if (runtime.deps.memory?.recordAccess) {
      const included = promptResult.provenance
        .filter((row) => row.section === "memory")
        .map((row) => row.blockId);
      try {
        await runtime.deps.memory.recordAccess(included, runtime.isoNow());
      } catch {
        warnings.push("Memory inclusion feedback could not be recorded.");
      }
    }

    const messages: ModelMessage[] = [...promptResult.request.messages];
    const toolCache = new ToolCallCache();
    const changedFiles: string[] = [];
    const mutationCheckpointIds: string[] = [];
    const establishedFacts: EstablishedFact[] = [];
    const memoryFacts = selectedMemory?.map((block) => ({
      id: block.id,
      content: block.content,
    }));

    const userPrompt = extractPrimaryUserMessage(envelope.message);
    warnPreflightRepairLock({
      route: decisionWithAttach.route,
      maximumWorkspaceEffect:
        decisionWithAttach.toolGrant.maximumWorkspaceEffect,
      repoBuildStateBefore: shared.repoBuildStateBefore,
      changedFilesCount: changedFiles.length,
      userPrompt,
      warnings,
    });

    const instructionBodies = buildInstructionBodies({
      skills: selectedSkills,
      rules: projectRules,
      environment: instructions?.environment,
    });

    const loopOutcome = await runV8ModelLoop(runtime, {
      runId,
      requestId: shared.requestId,
      interactionMode: envelope.mode,
      llm: runtime.deps.llm,
      request: promptResult.request,
      decision: decisionWithAttach,
      messages,
      bus,
      signal,
      budget,
      reasonCodes,
      warnings,
      toolCache,
      changedFiles,
      mutationCheckpointIds,
      dirtyPaths: input.dirtyPaths,
      pinnedState: shared.pinnedState,
      workspaceRoot: input.workspaceRoot,
      taskListRef,
      evidence: runEvidence,
      establishedFacts,
      windowPolicy,
      thresholdOverrides: input.v8LoopPolicy?.thresholds,
      criticMode: steering.criticMode,
      understanding,
      executionSeed: shared.executionSeed,
      repoBuildStateBefore: shared.repoBuildStateBefore,
      memoryFacts,
      memoryQuery: userPrompt,
      memoryWorkspaceId: envelope.workspace?.workspaceId,
      memoryFileTargets: extractMemoryFileTargets(understanding),
      logVerbosity: input.logVerbosity,
      selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
      projectRuleIds: projectRules.map((block) => block.id),
      environmentIds: (instructions?.environment ?? []).map(
        (block) => block.id,
      ),
      instructionBodies,
    });

    return await finishAfterLoop(runtime, {
      runId,
      requestId: shared.requestId,
      input,
      request: promptResult.request,
      decision: decisionWithAttach,
      bus,
      signal,
      pinnedState: shared.pinnedState,
      dirtyPaths: input.dirtyPaths,
      loopOutcome,
      reasonCodes,
      warnings,
      budget,
      startedAtMs: startedMs,
      finish,
      cancelledResult,
      taskListRef,
      repoBuildStateBefore: shared.repoBuildStateBefore,
      repoBuildStateAfter: shared.repoBuildStateAfter,
      evidence: runEvidence,
      onRepoBuildStateAfter: (state) => {
        shared.repoBuildStateAfter = state;
      },
      onVerificationRecord: (record) => {
        shared.verificationRecord = record;
      },
      windowPolicy,
      loopContext: {
        understanding,
        skillsQuery: userPrompt,
        mode: envelope.mode,
        projects: input.projects,
        memoryFacts,
        memoryQuery: userPrompt,
        memoryWorkspaceId: envelope.workspace?.workspaceId,
        memoryFileTargets: extractMemoryFileTargets(understanding),
        requiredSkillIds: input.requiredSkillIds ?? [],
        excludedSkillIds: input.excludedSkillIds ?? [],
        selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
        projectRuleIds: projectRules.map((block) => block.id),
        environmentIds: (instructions?.environment ?? []).map(
          (block) => block.id,
        ),
        instructionBodies,
        establishedFacts,
        plan: shared.runPlan,
        executionSeed: shared.executionSeed,
        nextPlanPhaseOffer: shared.nextPlanPhaseOffer,
      },
    });
  } catch (error) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    if (signal.aborted) {
      return await cancelledResult();
    }
    const message =
      error instanceof Error ? error.message : "Agent run failed.";
    const infrastructure = isProviderInfrastructureFailure({
      errorMessage: message,
    });
    return finish({
      status: "failed",
      reasonCodes: [
        ...reasonCodes,
        "provider_failed",
        ...(infrastructure
          ? (["provider_infrastructure_unavailable"] as const)
          : []),
      ],
      error: {
        code: infrastructure ? "provider_unavailable" : "execution_failed",
        message,
      },
    });
  }
}
