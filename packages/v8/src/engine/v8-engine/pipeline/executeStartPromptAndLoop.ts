/**
 * Post-enrichment start path: tools/prompt construction → model loop → finishAfterLoop.
 */
import type { ModelMessage } from "../../../modules/model-gateway";
import type { ExecutionDecision } from "../../../modules/decision-policy";
import type {
  PromptInstructions,
  PromptRepositoryContext,
  PromptSkillCatalogL1Entry,
} from "../../../modules/prompt-construction";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import {
  buildInstructionBodies,
  extractMemoryFileTargets,
} from "../actions";
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
import type { TaskListRef } from "../internal/taskListRuntime";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { WindowPolicy } from "../../../modules/window-budget";

import type { AgentEngineRuntime } from "./runtime";
import { finishAfterLoop } from "./verification";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import { warnPreflightRepairLock } from "./warnPreflightRepairLock";
import { runV8ModelLoop } from "./modelLoop";
import { constructStartPrompt } from "./executeStartPromptConstruct";

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

  const constructed = await constructStartPrompt({
    runtime,
    runId,
    input,
    bus,
    windowPolicy,
    reasonCodes,
    warnings,
    shared,
    envelope,
    understanding,
    decision,
    repositoryContext,
    selectedSkills,
    skillCatalogL1,
    selectedMemory,
    planText,
  });
  if (constructed.kind === "failed") {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return finish({
      status: "failed",
      reasonCodes: constructed.reasonCodes,
      ...(constructed.warnings ? { warnings: constructed.warnings } : {}),
      error: constructed.error,
    });
  }

  const {
    decisionWithAttach,
    promptResult,
    projectRules,
    instructions,
  } = constructed;

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

  const steering = resolveSteeringFeatureFlags(input.steering);
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
