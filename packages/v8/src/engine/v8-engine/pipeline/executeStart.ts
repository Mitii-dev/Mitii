import type { ModelMessage } from "../../../modules/model-gateway";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  type PromptInstructions,
} from "../../../modules/prompt-construction";
import {
  compileDecisionBrief,
  formatDecisionBriefForPrompt,
} from "../../../modules/decision-policy";
import { resolveSteeringFeatureFlags } from "../../agent-engine/steeringFlags";
import {
  annotateMutationToolDefinitions,
  applyExplorationSignal,
  clampRunBudget,
  toRunUsage,
  mergePromptInstructions,
  createInitialRunEvidence,
  finalizeRunEvidence,
} from "../../agent-engine/actions";
import { filterToolDefinitions } from "../actions/progressiveTools";
import { withMcpAttachOnGrant, formatMcpAttachInstruction } from "../../../modules/mcp-attach";
import type { EstablishedFact } from "../../agent-engine/actions";
import { ToolCallCache } from "../../agent-engine/internal/ToolCallCache";
import { AGENT_ENGINE_SCHEMA_VERSION } from "../../agent-engine/constants";
import {
  agentRunBudgetSchema,
  agentRunResultSchema,
} from "../contracts";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import { EventBus } from "../../agent-engine/internal/EventBus";
import { RunBudgetTracker } from "../../agent-engine/internal/RunBudget";
import { logVerbosityAtLeast } from "../../agent-engine/internal/logVerbosity";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../../agent-engine/internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../../agent-engine/policy";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";

import type { AgentEngineRuntime } from "../../agent-engine/pipeline/runtime";
import { resolveWorkspaceId } from "../../agent-engine/pipeline/runtime";
import { finishAfterLoop, persistVerificationArtifact } from "../../agent-engine/pipeline/verification";
import {
  runStartEarlyPipeline,
  type ExecuteStartSharedState,
} from "../../agent-engine/pipeline/executeStartEarlyPipeline";
import { runStartEnrichment } from "../../agent-engine/pipeline/executeStartEnrichment";

import { shouldForcePreflightRepairLock } from "../actions/userPathPriority";
import { runV8ModelLoop } from "./modelLoop";

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
        planTokens: planUsedTokens > 0 ? windowPolicy.sections.planTokens : 0,
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
    const wouldLock = shouldForcePreflightRepairLock({
      route: decisionWithAttach.route,
      maximumWorkspaceEffect:
        decisionWithAttach.toolGrant.maximumWorkspaceEffect,
      preflightErrorCount:
        shared.repoBuildStateBefore?.summary.errorCount ?? 0,
      changedFilesCount: changedFiles.length,
      userPrompt,
      diagnosticPaths: (shared.repoBuildStateBefore?.diagnostics ?? [])
        .filter((diagnostic) => diagnostic.severity === "error")
        .map((diagnostic) => diagnostic.path),
    });
    // Never arm repair-lock steering into the thin loop.
    if (
      (shared.repoBuildStateBefore?.summary.errorCount ?? 0) > 0 &&
      decisionWithAttach.route === "execute" &&
      !wouldLock
    ) {
      warnings.push(
        "User-cited paths diverge from preflight diagnostics; repair lock not applied.",
      );
    } else if (wouldLock) {
      warnings.push(
        "Preflight errors overlap the user request; thin loop still runs without mutation lock.",
      );
    }

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
        requiredSkillIds: input.requiredSkillIds ?? [],
        excludedSkillIds: input.excludedSkillIds ?? [],
        selectedSkillIds: selectedSkills?.map((block) => block.id) ?? [],
        projectRuleIds: projectRules.map((block) => block.id),
        environmentIds: (instructions?.environment ?? []).map(
          (block) => block.id,
        ),
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
        message: error instanceof Error ? error.message : "Agent run failed.",
      },
    });
  }
}
