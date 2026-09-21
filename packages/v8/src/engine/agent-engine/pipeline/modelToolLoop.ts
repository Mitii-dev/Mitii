import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
  ModelRequest,
} from "../../../modules/model-gateway";
import type {
  PlanArtifact,
} from "../../../modules/planning";
import type {
  ProjectDescriptor,
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type {
  RepoBuildState,
} from "../../../modules/verification";

import {
  compileDecisionBrief,
} from "../../../modules/decision-policy";
import {
  buildOutputTruncationRecovery,
  estimateStickyMutableChars,
  compactRecoveredAssistantContent,
  requiresMutationForExecute,
  reservedVerificationRepairModelCalls,
  recoverLeakedToolCallsFromMarkup,
  evaluateMutationCritic,
  extractMutationTargetPaths,
  isCompleteToolCall,
  resolveReasoningProgressBudget,
} from "../actions";
import type {
  EstablishedFact,
} from "../actions";
import type { SteeringCriticMode } from "../steeringFlags";
import { MUTATION_TOOL_IDS } from "../../tool-runtime";
import { ToolCallCache } from "../internal/ToolCallCache";
import { ReadLedger } from "../internal/ReadLedger";
import { InMemorySessionHistoryArchive } from "../internal/session-history";
import type {
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import {
  hasIncompleteChangeSurfaces,
  type TaskListRef,
} from "../internal/taskListRuntime";
import {
  AGENT_ENGINE_THRESHOLDS,
} from "../policy";
import type { AgentEngineThresholds } from "../actions/resolveAgentEngineThresholds";

import type { AgentEngineRuntime } from "./runtime";
import type {
  ToolLoopOutcome,
} from "./types";

import { consumeModelTurn } from "./consumeModelTurn";
import { appendTextContinuation } from "./appendTextContinuation";
export { appendTextContinuation } from "./appendTextContinuation";
import { prepareModelLoopTurn } from "./prepareModelLoopTurn";
import type { ModelLoopSession } from "./modelLoopSession";
import { handleNoToolModelTurn } from "./modelLoopNoToolTurn";
import { runModelLoopToolPhase } from "./modelLoopToolPhase";
import { resolveModelLoopAfterTools } from "./modelLoopAfterTools";
import { createLoopFileReadTracker } from "../actions";
import { tryOfferBudgetWallContinue } from "./tryOfferBudgetWallContinue";
import {
  filterToolsForMutationLock,
  filterToolsForMutationOnly,
  initialPostNudgeEvidenceReadsUsed,
  isMutationLocked,
  remainingPostNudgeEvidenceReads,
} from "./mutationLockTools";
import { filterToolsForAnswerLock } from "./diagnoseAnswerLock";

export async function runModelToolLoop(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  request: ModelRequest;
  decision: ExecutionDecision;
  understanding?: RequestUnderstandingResult;
  skillsQuery?: string;
  mode?: "ask" | "plan" | "agent";
  /** Correlates RestorePoints; defaults to runId when omitted. */
  requestId?: string;
  projects?: readonly ProjectDescriptor[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  memoryFacts?: readonly { id: string; content: string }[];
  establishedFacts?: EstablishedFact[];
  selectedSkillIds?: string[];
  projectRuleIds?: string[];
  environmentIds?: string[];
  requiredSkillIds?: string[];
  excludedSkillIds?: string[];
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
  repoBuildStateBefore?: RepoBuildState;
  logVerbosity: AgentLogVerbosity;
  /**
   * First mutate loop only: hold back window-effort repair calls so
   * remaining-error verification can start after a productive loop.
   */
  reserveVerificationRepairModelCalls?: boolean;
  plan?: PlanArtifact;
  /**
   * Resolved loop/stall thresholds (working standards + optional host overrides).
   * When omitted, shipped `AGENT_ENGINE_THRESHOLDS` apply.
   */
  thresholds?: AgentEngineThresholds;
  /** Seeded from checkpoint when resuming after a Continue approval. */
  continueOverrideCount?: number;
  /**
   * After Continue on an unfulfilled/exploration wall with zero edits, start
   * the loop already awaiting the first mutation so broad rediscovery fails
   * closed instead of repeating the research stall.
   */
  forceMutationOnResume?: boolean;
  /**
   * Verification repair / remaining-error passes: lock tools to mutation +
   * targeted reads even when files were already changed (BillBuddy 00:48).
   */
  forceMutationLock?: boolean;
  /** Pre-mutation critic mode from steering flags (default off). */
  criticMode?: SteeringCriticMode;
}): Promise<ToolLoopOutcome> {
  const {
    runId,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
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
    evidence,
    logVerbosity,
  } = params;
  const criticMode: SteeringCriticMode = params.criticMode ?? "off";
  const thresholds = params.thresholds ?? AGENT_ENGINE_THRESHOLDS;
  const establishedFacts = params.establishedFacts ?? [];
  const readLedger = new ReadLedger();
  const loopFileReads = createLoopFileReadTracker();
  const mustReadNudgeBudget = {
    remaining: thresholds.maxMustReadNudges,
  };
  const changeImpactGate = {
    required:
      params.decision.reasonCodes.includes("change_impact_recommended") &&
      params.decision.toolGrant.allowedTools.includes("analyze_change_impact"),
    satisfied: false,
  };
  const changeImpactNudgeBudget = {
    remaining: changeImpactGate.required
      ? thresholds.maxChangeImpactNudges
      : 0,
  };

  const forceMutationOnResume =
    params.forceMutationOnResume === true &&
    requiresMutationForExecute({
      route: params.decision.route,
      maximumWorkspaceEffect: params.decision.toolGrant.maximumWorkspaceEffect,
      primaryTaskIntent:
        params.understanding?.intent.classification.primaryTaskIntent,
      reasonCodes: params.decision.reasonCodes,
    }) &&
    changedFiles.length === 0;

  // Repair loops already have changed files — still lock to mutation tools.
  const forceMutationLock =
    forceMutationOnResume || params.forceMutationLock === true;

  const session: ModelLoopSession = {
    decision: params.decision,
    selectedSkillIds: [...(params.selectedSkillIds ?? [])],
    projectRuleIds: [...(params.projectRuleIds ?? [])],
    environmentIds: [...(params.environmentIds ?? [])],
    answer: "",
    truncationRecoveries: 0,
    incompleteAnswerRecoveries: 0,
    unfulfilledExecuteRecoveries: 0,
    emitReviewFindingCount: 0,
    structuredReviewRecoveries: 0,
    pendingTextContinuation: "",
    emittedLoopPressureWarning: false,
    emittedLoopCompactionWarning: false,
    successfulVerificationAfterMutation: false,
    explorationStallNudges: 0,
    continueOverrideCount: Math.max(0, params.continueOverrideCount ?? 0),
    rejectedMutationRecoveries: 0,
    rejectedToolRecoveries: 0,
    readOnlyToolTurnsWithoutMutation: forceMutationLock
      ? thresholds.maxReadOnlyToolTurnsBeforeMutationNudge
      : 0,
    readOnlyToolTurnsAfterMutation: 0,
    afterMutationReadOnlyNudges: 0,
    awaitingReadOnlyMutationRetry: forceMutationLock,
    // Continue / repair: evidence-read used count — first Continue keeps the
    // full allowance; later Continues and verification repairs start spent.
    readOnlyMutationRetryAttempts: forceMutationLock
      ? thresholds.maxReadOnlyMutationRetryAttempts
      : 0,
    postNudgeEvidenceReadTurns: initialPostNudgeEvidenceReadsUsed({
      forceMutationOnResume,
      forceMutationLock: params.forceMutationLock === true,
      continueOverrideCount: Math.max(0, params.continueOverrideCount ?? 0),
      maxPostNudgeEvidenceReadTurns: thresholds.maxPostNudgeEvidenceReadTurns,
    }),
    consecutiveSameToolTurns: 0,
    lastUniformToolName: undefined,
    diagnoseAnswerNudges: 0,
    awaitingAnswerOnly: false,
    mutationBlockerAsked: false,
    fileBodyReadsWithoutCodeIntel: 0,
    codeIntelToolUses: 0,
    codeIntelAdoptionNudges: 0,
    reasoningProgressBudgetExceedances: 0,
    observedReasoningChannel: false,
    awaitingRejectedMutationRetry: undefined,
    lastPromptCacheClass: undefined,
    contextEpoch: runtime.contextEpochs.get(runId),
    sessionHistoryArchive: new InMemorySessionHistoryArchive(),
  };

  const isMutationRequired = () =>
    requiresMutationForExecute({
      route: session.decision.route,
      maximumWorkspaceEffect: session.decision.toolGrant.maximumWorkspaceEffect,
      primaryTaskIntent:
        params.understanding?.intent.classification.primaryTaskIntent,
      reasonCodes: session.decision.reasonCodes,
    });

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }

    const exhausted = budget.isExhausted();
    if (exhausted) {
      const offered = tryOfferBudgetWallContinue({
        wallReason: "budget_exhausted",
        messages,
        toolCache,
        changedFiles,
        mutationCheckpointIds,
        answer: session.answer,
        decision: session.decision,
        continueOverrideCount: session.continueOverrideCount,
        maxContinueOverrides: thresholds.maxContinueOverrides,
        taskList: taskListRef.current,
        mutationRequired: isMutationRequired(),
        budgetMessage: `Run budget exhausted (${exhausted}).`,
      });
      if (offered) {
        return offered;
      }
      reasonCodes.push("stall_continue_override_capped");
      return {
        kind: "budget_exhausted",
        answer: session.answer || undefined,
        message: `Run budget exhausted (${exhausted}).`,
        changedFiles,
        mutationCheckpointIds,
      };
    }

    const reservedRepairCalls =
      params.reserveVerificationRepairModelCalls === true
        ? reservedVerificationRepairModelCalls({
            maxModelCalls: budget.maxModelCalls(),
            maxVerificationRepairs:
              params.windowPolicy.run.maxVerificationRepairs,
            thresholds,
          })
        : 0;
    const reserveForThisTurn =
      changedFiles.length > 0 ? reservedRepairCalls : 0;
    if (!budget.canStartModelCall(reserveForThisTurn)) {
      if (changedFiles.length > 0 && budget.canStartModelCall()) {
        reasonCodes.push("verification_repair_budget_reserved");
        warnings.push(
          "Leaving remaining model-call budget for verification repair after mutations.",
        );
        return {
          kind: "completed",
          answer: session.answer,
          changedFiles,
          mutationCheckpointIds,
          messages,
          toolCache,
          decision: session.decision,
        };
      }
      const offered = tryOfferBudgetWallContinue({
        wallReason: "budget_exhausted",
        messages,
        toolCache,
        changedFiles,
        mutationCheckpointIds,
        answer: session.answer,
        decision: session.decision,
        continueOverrideCount: session.continueOverrideCount,
        maxContinueOverrides: thresholds.maxContinueOverrides,
        taskList: taskListRef.current,
        mutationRequired: isMutationRequired(),
        budgetMessage: "Model call budget exhausted.",
      });
      if (offered) {
        return offered;
      }
      reasonCodes.push("stall_continue_override_capped");
      return {
        kind: "budget_exhausted",
        answer: session.answer || undefined,
        message: "Model call budget exhausted.",
        changedFiles,
        mutationCheckpointIds,
      };
    }

    budget.recordLoopIteration();
    budget.recordModelCall();
    runtime.emitStage(bus, runId, "model_running", "started");

    const mutationLocked = isMutationLocked({
      awaitingReadOnlyMutationRetry: session.awaitingReadOnlyMutationRetry,
      postNudgeEvidenceReadTurns: session.postNudgeEvidenceReadTurns,
      maxPostNudgeEvidenceReadTurns: thresholds.maxPostNudgeEvidenceReadTurns,
    });
    const evidenceRemaining = remainingPostNudgeEvidenceReads({
      postNudgeEvidenceReadTurns: session.postNudgeEvidenceReadTurns,
      maxPostNudgeEvidenceReadTurns: thresholds.maxPostNudgeEvidenceReadTurns,
    });
    const turnModelRequest: ModelRequest = session.awaitingAnswerOnly
      ? {
          ...params.request,
          tools: filterToolsForAnswerLock(params.request.tools),
        }
      : mutationLocked
        ? {
            ...params.request,
            tools:
              evidenceRemaining > 0
                ? filterToolsForMutationLock(params.request.tools)
                : filterToolsForMutationOnly(params.request.tools),
          }
        : params.request;

    const prepared = prepareModelLoopTurn({
      runtime,
      runId,
      bus,
      request: turnModelRequest,
      messages,
      budget,
      windowPolicy: params.windowPolicy,
      taskListRef,
      grantPathScopes: session.decision.toolGrant.pathScopes,
      mutationBudget: session.decision.toolGrant.mutationBudget,
      repoBuildStateBefore: params.repoBuildStateBefore,
      memoryFacts: params.memoryFacts,
      establishedFacts,
      reasonCodes,
      warnings,
      logVerbosity,
      lastPromptCacheClass: session.lastPromptCacheClass,
      emittedLoopPressureWarning: session.emittedLoopPressureWarning,
      emittedLoopCompactionWarning: session.emittedLoopCompactionWarning,
      contextEpoch: session.contextEpoch,
      decisionRoute: session.decision.route,
      decisionPlanningDepth: session.decision.planningDepth,
      selectedSkillIds: session.selectedSkillIds,
      projectRuleIds: session.projectRuleIds,
      environmentIds: session.environmentIds,
      memoryIds: params.memoryFacts?.map((fact) => fact.id) ?? [],
      mutationLocked,
      sessionHistoryArchive: session.sessionHistoryArchive,
    });
    session.emittedLoopPressureWarning = prepared.emittedLoopPressureWarning;
    session.emittedLoopCompactionWarning = prepared.emittedLoopCompactionWarning;
    session.lastPromptCacheClass = prepared.promptCacheClass;
    session.contextEpoch = prepared.contextEpoch;
    if (prepared.contextEpoch) {
      runtime.contextEpochs.set(runId, prepared.contextEpoch);
      const store = runtime.deps.contextEpochStore;
      if (store) {
        void store.save(prepared.contextEpoch).catch(() => {
          /* best-effort; checkpoint remains authoritative */
        });
      }
    }
    const { turnRequest, preservePrefix, promptCacheClass, compaction } =
      prepared;

    const reasoningBudget = resolveReasoningProgressBudget({
      thresholds,
      supportsReasoning: runtime.deps.llm.capabilities.supportsReasoning,
      observedReasoningChannel: session.observedReasoningChannel,
    });
    const stickyMutable = estimateStickyMutableChars(turnRequest.messages);
    const turn = await consumeModelTurn(runtime, {
      llm: runtime.deps.llm,
      request: turnRequest,
      runId,
      signal,
      bus,
      maxReasoningCharsWithoutProgress: reasoningBudget.baseChars,
      tightReasoningCharsWhenChannelActive: reasoningBudget.tightChars,
    });

    if (turn.kind === "cancelled") {
      runtime.emitStage(bus, runId, "model_running", "completed", ["cancelled"]);
      return { kind: "cancelled" };
    }

    if (turn.kind === "completed" && turn.observedReasoningChannel) {
      session.observedReasoningChannel = true;
    }

    if (turn.kind === "failed") {
      const canRecoverProviderAsUnfulfilled =
        isMutationRequired() &&
        changedFiles.length === 0 &&
        session.unfulfilledExecuteRecoveries <
          thresholds.maxUnfulfilledExecuteRecoveries &&
        budget.canStartModelCall() &&
        (turn.errorCode === "provider_failed" ||
          /timeout|aborted|abort/i.test(turn.errorMessage));
      if (canRecoverProviderAsUnfulfilled) {
        session.unfulfilledExecuteRecoveries += 1;
        reasonCodes.push("unfulfilled_execute_recovered", "provider_failed");
        runtime.emitStage(bus, runId, "model_running", "completed", [
          "unfulfilled_execute_recovered",
        ]);
        if (turn.content.trim().length > 0) {
          messages.push({
            role: "assistant",
            content: turn.content.slice(0, thresholds.maxRecoveredAnalysisChars),
          });
          session.answer = turn.content;
        }
        messages.push({
          role: "user",
          content: [
            "The previous model turn failed or timed out while planning without applying a workspace edit.",
            "Do not resume the essay. Call apply_patch/delete_file/move_file now on a bounded surface.",
            "Targeted read_file of an active write/mustRead path is allowed only if required for an exact patch.",
            "Do not call list_directory, glob_files, or search_files for broad rediscovery.",
          ].join(" "),
        });
        warnings.push(
          "Provider failed during an unfulfilled execute turn; recovering toward apply_patch.",
        );
        session.awaitingReadOnlyMutationRetry = true;
        continue;
      }
      reasonCodes.push("provider_failed");
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "provider_failed",
      ]);
      return {
        kind: "failed",
        answer: turn.content || session.answer || undefined,
        extraReasons: ["provider_failed"],
        error: {
          code: turn.errorCode,
          message: turn.errorMessage,
        },
      };
    }

    if (turn.usage) {
      budget.addUsage(turn.usage);
    }

    if (turn.reasoningBudgetExceeded) {
      reasonCodes.push("reasoning_progress_budget_exceeded");
      session.reasoningProgressBudgetExceedances += 1;
      session.observedReasoningChannel = true;
      // Repeated thinking-only burns with write still required: lock mutation
      // and spend evidence reads so the next turns only see apply_patch*.
      const incompleteChangeSurfaces = hasIncompleteChangeSurfaces(
        params.taskListRef.current,
      );
      if (
        isMutationRequired() &&
        (changedFiles.length === 0 || incompleteChangeSurfaces) &&
        thresholds.maxReasoningProgressBudgetExceedancesBeforeMutationLock >
          0 &&
        session.reasoningProgressBudgetExceedances >=
          thresholds.maxReasoningProgressBudgetExceedancesBeforeMutationLock
      ) {
        session.awaitingReadOnlyMutationRetry = true;
        session.postNudgeEvidenceReadTurns =
          thresholds.maxPostNudgeEvidenceReadTurns;
        reasonCodes.push("unfulfilled_execute_recovered");
        warnings.push(
          "Repeated reasoning-only turns without tools; locking to mutation tools.",
        );
      }
    }

    const truncated = turn.finishReason === "length";
    runtime.emit(bus, {
      type: "model_turn",
      runId,
      turnIndex: Math.max(0, budget.snapshot().modelCalls - 1),
      inputTokens: turn.usage?.inputTokens,
      outputTokens: turn.usage?.outputTokens,
      cacheHitTokens: turn.usage?.cacheHitTokens,
      cacheMissTokens: turn.usage?.cacheMissTokens,
      finishReason: turn.finishReason,
      truncated: truncated || undefined,
      preservePrefix,
      promptCacheClass,
      stickyInputChars: stickyMutable.stickyChars,
      mutableInputChars: stickyMutable.mutableChars,
      compactionPressure: compaction.pressure,
      at: runtime.isoNow(),
    });

    if (truncated) {
      reasonCodes.push("output_truncated");
      warnings.push(
        "Model output stopped early because the output token limit was reached.",
      );
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          "Response truncated: output token limit reached. Retrying with a smaller mutation batch when tools were incomplete; otherwise raise mitii.provider.maximumOutputTokens.",
        at: runtime.isoNow(),
      });
    }

    const grant = session.decision.toolGrant;
    const recovery = buildOutputTruncationRecovery({
      finishReason: turn.finishReason,
      content: turn.content,
      toolCalls: turn.toolCalls,
      mutationBudget: grant.mutationBudget,
      recoveryAttempt: session.truncationRecoveries,
      requireMutation: requiresMutationForExecute({
        route: session.decision.route,
        maximumWorkspaceEffect: grant.maximumWorkspaceEffect,
        primaryTaskIntent:
          params.understanding?.intent.classification.primaryTaskIntent,
        reasonCodes: session.decision.reasonCodes,
      }),
      changedFileCount: changedFiles.length,
      hasIncompleteChangeSurfaces: hasIncompleteChangeSurfaces(
        params.taskListRef.current,
      ),
      successfulVerificationAfterMutation:
        session.successfulVerificationAfterMutation,
      thresholds,
    });

    if (recovery?.shouldRecover) {
      session.truncationRecoveries += 1;
      reasonCodes.push("output_truncation_recovered");
      if (recovery.recoveryKind === "text_continuation") {
        session.pendingTextContinuation = appendTextContinuation(
          session.pendingTextContinuation,
          recovery.assistantContent,
        );
        session.answer = session.pendingTextContinuation;
      } else if (recovery.assistantContent.trim().length === 0) {
        // Reasoning-burn recovery: clear any poisoned pending essay.
        session.pendingTextContinuation = "";
      }
      messages.push({
        role: "assistant",
        content: compactRecoveredAssistantContent(
          recovery.assistantContent,
          thresholds.maxRecoveredAnalysisChars,
        ),
      });
      messages.push(recovery.recoveryMessage);
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          recovery.recoveryKind === "text_continuation"
            ? "Continuing truncated final answer after output token limit."
            : "Discarded incomplete truncated tool call(s); continuing with a smaller-batch instruction.",
        at: runtime.isoNow(),
      });
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
        "output_truncated",
        "output_truncation_recovered",
      ]);
      continue;
    }

    if (
      truncated &&
      changedFiles.length > 0 &&
      turn.toolCalls.every((call) => !isCompleteToolCall(call))
    ) {
      reasonCodes.push("output_truncation_finish_after_mutation");
    }

    reasonCodes.push("model_completed");
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      ...(truncated ? (["output_truncated"] as const) : []),
    ]);

    let toolCalls = truncated
      ? turn.toolCalls.filter((call) => isCompleteToolCall(call))
      : turn.toolCalls;
    if (
      toolCalls.length === 0 &&
      turn.content.trim().length > 0 &&
      /<\s*(?:read_file|read_many_files|search_files|glob_files|list_directory|goto_definition|find_references|hover_symbol|document_symbol|workspace_symbol|find_implementation|call_hierarchy|analyze_change_impact)\b/i.test(
        turn.content,
      )
    ) {
      const recovered = recoverLeakedToolCallsFromMarkup({
        content: turn.content,
        allowedToolNames: new Set(grant.allowedTools),
      });
      toolCalls = recovered.toolCalls;
      if (recovered.warnings.length > 0) {
        warnings.push(...recovered.warnings);
      }
    }

    if (toolCalls.length === 0) {
      const noTool = handleNoToolModelTurn({
        runtime,
        runId,
        bus,
        session,
        decision: session.decision,
        grant,
        understanding: params.understanding,
        turnContent: turn.content,
        finishReason: turn.finishReason,
        truncated,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        budget,
        reasonCodes,
        warnings,
        thresholds,
        taskListRef,
      });
      if (noTool.kind === "return") {
        return noTool.outcome;
      }
      continue;
    }

    // Pre-mutation critic (narrow/pause only). Runs before Tool Runtime.
    const mutationToolNames = toolCalls
      .map((call) => call.name)
      .filter((name) =>
        (MUTATION_TOOL_IDS as readonly string[]).includes(name) ||
        name === "run_command",
      );
    if (mutationToolNames.length > 0 && criticMode !== "off") {
      const intendedPaths: string[] = [];
      for (const call of toolCalls) {
        let args: unknown = call.arguments;
        if (typeof args === "string") {
          try {
            args = JSON.parse(args);
          } catch {
            args = undefined;
          }
        }
        intendedPaths.push(...extractMutationTargetPaths(call.name, args));
      }
      const brief = compileDecisionBrief({
        decision: session.decision,
        understanding: params.understanding,
      });
      const critic = evaluateMutationCritic({
        decision: session.decision,
        brief,
        mutationToolNames,
        intendedPaths,
        proposedSummary: turn.content.slice(0, 800),
        mode: criticMode,
      });
      if (critic.shadowWouldBlock) {
        reasonCodes.push("mutation_critic_shadow_block");
        warnings.push(
          `Mutation critic (shadow) would block: ${critic.reasons.join(" ")}`,
        );
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: `Mutation critic shadow: ${critic.reasons[0] ?? "would block"}`,
          at: runtime.isoNow(),
        });
      }
      if (critic.verdict === "pass" && !critic.shadowWouldBlock) {
        reasonCodes.push("mutation_critic_pass");
      } else if (critic.verdict === "revise") {
        reasonCodes.push("mutation_critic_revise");
        if (critic.narrowToPaths && critic.narrowToPaths.length > 0) {
          if (runtime.deps.decision.narrow) {
            session.decision = runtime.deps.decision.narrow({
              previous: session.decision,
              discoveredPaths: critic.narrowToPaths,
            });
            reasonCodes.push("grant_narrowed");
          }
        }
        warnings.push(`Mutation critic revise: ${critic.reasons.join(" ")}`);
        messages.push({
          role: "user",
          content:
            `Mutation critic requires revision before applying edits:\n` +
            critic.reasons.map((r) => `- ${r}`).join("\n") +
            `\nAdjust the plan or tool calls; do not widen authority.`,
        });
        continue;
      } else if (critic.verdict === "stop_and_clarify") {
        reasonCodes.push("mutation_critic_stop");
        warnings.push(`Mutation critic stop: ${critic.reasons.join(" ")}`);
        messages.push({
          role: "user",
          content:
            `Mutation critic blocked this mutation batch:\n` +
            critic.reasons.map((r) => `- ${r}`).join("\n") +
            `\nDo not execute those mutations. Clarify or stay in-scope.`,
        });
        continue;
      }
    }

    const toolPhase = await runModelLoopToolPhase({
      runtime,
      runId,
      bus,
      signal,
      session,
      toolCalls,
      turnContent: turn.content,
      dirtyPaths,
      pinnedState,
      workspaceRoot,
      messages,
      toolCache,
      readLedger,
      budget,
      warnings,
      reasonCodes,
      changedFiles,
      mutationCheckpointIds,
      taskListRef,
      evidence,
      establishedFacts,
      windowPolicy: params.windowPolicy,
      loopFileReads,
      mustReadNudgeBudget,
      changeImpactNudgeBudget,
      plan: params.plan,
      understanding: params.understanding,
      skillsQuery: params.skillsQuery,
      mode: params.mode,
      projects: params.projects,
      requiredSkillIds: params.requiredSkillIds,
      excludedSkillIds: params.excludedSkillIds,
      answer: session.answer,
      changeImpactGate,
      thresholds,
      requestId: params.requestId ?? runId,
    });
    if (toolPhase.kind !== "batch_done") {
      if (toolPhase.kind === "return") {
        return toolPhase.outcome;
      }
      continue;
    }

    const after = resolveModelLoopAfterTools({
      runtime,
      runId,
      bus,
      session,
      decision: session.decision,
      grant: session.decision.toolGrant,
      toolCalls,
      stats: toolPhase.stats,
      isMutationRequired,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      budget,
      reasonCodes,
      warnings,
      thresholds,
      taskListRef,
      loopFileReads,
      logVerbosity,
    });
    if (after.kind === "return") {
      return after.outcome;
    }
  }
}
