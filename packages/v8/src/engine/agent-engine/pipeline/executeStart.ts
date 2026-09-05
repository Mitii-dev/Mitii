import type {
  ModelMessage,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
} from "../../../modules/prompt-construction";
import type {
  PromptInstructions,
} from "../../../modules/prompt-construction";

import {
  annotateMutationToolDefinitions,
  applyExplorationSignal,
  clampRunBudget,
  toRunUsage,
  filterToolDefinitions,
  mergePromptInstructions,
  createInitialRunEvidence,
  finalizeRunEvidence,
} from "../actions";
import type {
  EstablishedFact,
} from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../constants";
import {
  agentRunBudgetSchema,
  agentRunResultSchema,
} from "../contracts";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
} from "../internal/logVerbosity";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  DEFAULT_TOOL_DEFINITIONS,
} from "../policy";
import { resolveLoopPolicyThresholds } from "../actions/resolveLoopPolicyThresholds";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";

import { runModelToolLoop } from "./modelToolLoop";
import {
  finishAfterLoop,
  persistVerificationArtifact,
} from "./verification";
import {
  runStartEarlyPipeline,
  type ExecuteStartSharedState,
} from "./executeStartEarlyPipeline";
import { runStartEnrichment } from "./executeStartEnrichment";

export async function executeStart(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  getCancelReason: () => string | undefined;
  /** Previously approved/edited plan (plan-approval resume or host carry). */
  approvedPlan?: PlanArtifact;
  /** Strategy for an approved/carried plan; inferred from the artifact when omitted. */
  approvedPlanStrategy?: PlanStrategyDecision;
  /** Skip plan-gate suspension (after user approved/edited the plan). */
  skipPlanGate?: boolean;
  /** How an approved plan entered this run (affects reason codes). */
  planSource?: "host_carry" | "resume_approval";
}): Promise<AgentRunResult> {
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
  if (
    runBudgetClamp.clamped.length > 0 &&
    logVerbosityAtLeast(input.logVerbosity, "standard")
  ) {
    for (const field of runBudgetClamp.clamped) {
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: `Run budget "${field.field}" reduced from ${field.requested} to ${field.effective} by the window policy.`,
        code: "run_budget_clamped",
        data: {
          field: field.field,
          requested: field.requested,
          effective: field.effective,
        },
        at: runtime.isoNow(),
      });
    }
  }
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
    const result = agentRunResultSchema.parse({
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
      selectedMemory,
      planText,
    } = enrichment.state;

    // --- Prompt ---
    const tools = annotateMutationToolDefinitions(
      attachTaskListTool({
        mode: envelope.mode,
        tools: filterToolDefinitions({
          grant: decision.toolGrant,
          definitions:
            input.tools ?? runtime.deps.toolDefinitions ?? DEFAULT_TOOL_DEFINITIONS,
          supportsTools: runtime.deps.llm.capabilities.supportsTools,
        }),
      }),
      decision.toolGrant.mutationBudget,
    );

    const projectRules = [...(input.instructions?.projectRules ?? [])];
    const hostInstructions: PromptInstructions | undefined =
      projectRules.length > 0
        ? {
            ...input.instructions,
            projectRules,
          }
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

    const promptResult = runtime.deps.prompt.construct({
      schemaVersion: PROMPT_CONSTRUCTION_SCHEMA_VERSION,
      decision,
      userMessage: envelope.message,
      attachments: envelope.attachments,
      conversation: input.conversation,
      repositoryContext,
      instructions,
      planText,
      tools,
      capabilities: runtime.deps.llm.capabilities,
      model: input.model,
      temperature: input.temperature,
      stream: input.stream,
      outputReserveTokens: windowPolicy.maximumOutputTokens,
      planBudgetTokens: planText ? windowPolicy.sections.planTokens : 0,
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
    // Always emit: hosts need budget/window for the token-meter tree.
    // Omissions and warning text stay verbosity-gated.
    const includePromptDetails = logVerbosityAtLeast(
      input.logVerbosity,
      "standard",
    );
    const planSection = promptResult.budget.sections.find(
      (section) => section.section === "plan",
    );
    const planUsedTokens = planSection?.usedTokens ?? 0;
    runtime.emit(bus, {
      type: "prompt_ready",
      runId,
      status: promptResult.status,
      totalOmittedTokens: promptResult.budget.totalOmittedTokens,
      totalTruncatedTokens: promptResult.budget.totalTruncatedTokens,
      budget: {
        contextWindowTokens: promptResult.budget.contextWindowTokens,
        outputReservedTokens: promptResult.budget.outputReservedTokens,
        inputBudgetTokens: promptResult.budget.inputBudgetTokens,
        totalUsedTokens: promptResult.budget.totalUsedTokens,
        withinLimits: promptResult.budget.withinLimits,
        sections: promptResult.budget.sections.slice(0, 16).map((section) => ({
          section: section.section,
          allocatedTokens: section.allocatedTokens,
          usedTokens: section.usedTokens,
          omittedTokens: section.omittedTokens,
          truncatedTokens: section.truncatedTokens,
        })),
      },
      window: {
        toolSchemaTokens: windowPolicy.toolSchemaTokens,
        usableInputTokens: windowPolicy.usableInputTokens,
        repositoryTokens: windowPolicy.sections.repositoryTokens,
        conversationTokens: windowPolicy.sections.conversationTokens,
        planTokens:
          planUsedTokens > 0 ? windowPolicy.sections.planTokens : 0,
        planUsedTokens,
        skillsTokens: windowPolicy.sections.skillsTokens,
        systemTokens: windowPolicy.sections.systemTokens,
      },
      ...(includePromptDetails && promptResult.omissions.length > 0
        ? {
            omissions: promptResult.omissions.slice(0, 20).map((omission) => ({
              section: omission.section,
              reason: omission.reason,
              ...(typeof omission.tokens === "number"
                ? { tokens: omission.tokens }
                : {}),
            })),
          }
        : {}),
      ...(includePromptDetails && promptResult.warnings.length > 0
        ? { warnings: promptResult.warnings.slice(0, 20) }
        : {}),
      at: runtime.isoNow(),
    });

    // --- Model / tool loop ---
    const messages: ModelMessage[] = [...promptResult.request.messages];
    const toolCache = new ToolCallCache();
    const changedFiles: string[] = [];
    const mutationCheckpointIds: string[] = [];
    const establishedFacts: EstablishedFact[] = [];
    const memoryFacts = selectedMemory?.map((block) => ({
      id: block.id,
      content: block.content,
    }));
    const thresholds = resolveLoopPolicyThresholds({
      contextWindowTokens: windowPolicy.contextWindowTokens,
      overrides: input.loopPolicy?.thresholds,
    }).thresholds;

    const loopOutcome = await runModelToolLoop(runtime, {
      runId,
      request: promptResult.request,
      decision,
      understanding,
      skillsQuery: extractPrimaryUserMessage(envelope.message),
      mode: envelope.mode,
      projects: input.projects,
      dirtyPaths: input.dirtyPaths,
      pinnedState: shared.pinnedState,
      workspaceRoot: input.workspaceRoot,
      bus,
      signal,
      budget,
      reasonCodes,
      warnings,
      messages,
      toolCache,
      changedFiles,
      mutationCheckpointIds,
      taskListRef,
      memoryFacts,
      establishedFacts,
      requiredSkillIds: input.requiredSkillIds ?? [],
      selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
      evidence: runEvidence,
      windowPolicy,
      repoBuildStateBefore: shared.repoBuildStateBefore,
      logVerbosity: input.logVerbosity,
      reserveVerificationRepairModelCalls: true,
      plan: shared.runPlan,
      thresholds,
    });

    return await finishAfterLoop(runtime, {
      runId,
      requestId: shared.requestId,
      input,
      request: promptResult.request,
      decision,
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
        skillsQuery: extractPrimaryUserMessage(envelope.message),
        mode: envelope.mode,
        projects: input.projects,
        memoryFacts,
        requiredSkillIds: input.requiredSkillIds ?? [],
        selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
        establishedFacts,
        plan: shared.runPlan,
      },
    });
  } catch (error) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    if (signal.aborted) {
      return await cancelledResult();
    }
    return finish({
      status: "failed",
      reasonCodes: [...reasonCodes, "provider_failed"],
      error: {
        code: "execution_failed",
        message:
          error instanceof Error ? error.message : "Agent run failed.",
      },
    });
  }
}
