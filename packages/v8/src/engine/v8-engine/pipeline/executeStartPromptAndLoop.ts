/**
 * Post-enrichment start path: tools/prompt construction → model loop → finishAfterLoop.
 */
import type { ModelMessage } from "../../../modules/model-gateway";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  PROMPT_CONSTRUCTION_SCHEMA_VERSION,
  mergePromptInstructions,
  type PromptInstructions,
  type PromptRepositoryContext,
  type PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import {
  compileDecisionBrief,
  formatDecisionBriefForPrompt,
} from "../../../modules/decision-policy";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import {
  annotateMutationToolDefinitions,
  buildInstructionBodies,
  extractMemoryFileTargets,
  formatExecutionSeedForPrompt,
} from "../actions";
import { filterToolDefinitions } from "../actions/filterToolDefinitions";
import {
  withMcpAttachOnGrant,
  formatMcpAttachInstruction,
} from "../../../modules/mcp-attach";
import type { EstablishedFact } from "../actions";
import { ToolCallCache } from "../internal/ToolCallCache";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import {
  attachTaskListTool,
  type TaskListRef,
} from "../internal/taskListRuntime";
import { DEFAULT_TOOL_DEFINITIONS } from "../legacy/policy";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { AgentEngineRuntime } from "./runtime";
import { finishAfterLoop } from "./verification";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import { warnPreflightRepairLock } from "./warnPreflightRepairLock";
import { emitPromptReady } from "./emitPromptReady";
import { runV8ModelLoop } from "./modelLoop";

type FinishFn = Parameters<typeof finishAfterLoop>[1]["finish"];
type CancelledFn = Parameters<typeof finishAfterLoop>[1]["cancelledResult"];

export async function runStartPromptAndLoop(params: {
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
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  repositoryContext: PromptRepositoryContext | undefined;
  selectedSkills: PromptInstructions["skills"];
  skillCatalogL1: readonly PromptSkillCatalogL1Entry[] | undefined;
  selectedMemory: PromptInstructions["memory"];
  planText: string | undefined;
  finish: FinishFn;
  cancelledResult: CancelledFn;
}): Promise<AgentRunResult> {
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
    envelope,
    understanding,
    decision,
    repositoryContext,
    selectedSkills,
    skillCatalogL1,
    selectedMemory,
    planText,
    finish,
    cancelledResult,
  } = params;

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
      skillCatalogL1MaxEntries: windowPolicy.fragments.skillCatalogL1MaxEntries,
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
    maximumWorkspaceEffect: decisionWithAttach.toolGrant.maximumWorkspaceEffect,
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
    environmentIds: (instructions?.environment ?? []).map((block) => block.id),
    instructionBodies,
  });

  return finishAfterLoop(runtime, {
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
      environmentIds: (instructions?.environment ?? []).map((block) => block.id),
      instructionBodies,
      establishedFacts,
      plan: shared.runPlan,
      executionSeed: shared.executionSeed,
      nextPlanPhaseOffer: shared.nextPlanPhaseOffer,
    },
  });
}
