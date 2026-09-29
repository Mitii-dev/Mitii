import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  LlmPort,
  ModelMessage,
  ModelRequest,
} from "../../../modules/model-gateway";
import type { AgentMode } from "../../../modules/request-intake";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import type {
  AgentReasonCode,
  RunEvidence,
} from "../../agent-engine/contracts";
import type { EstablishedFact } from "../../agent-engine/actions";
import { EventBus } from "../../agent-engine/internal/EventBus";
import { ReadLedger } from "../../agent-engine/internal/ReadLedger";
import { RunBudgetTracker } from "../../agent-engine/internal/RunBudget";
import { ToolCallCache } from "../../agent-engine/internal/ToolCallCache";
import type { TaskListRef } from "../../agent-engine/internal/taskListRuntime";
import { consumeModelTurn } from "../../agent-engine/pipeline/consumeModelTurn";
import { tryOfferBudgetWallContinue } from "../../agent-engine/pipeline/tryOfferBudgetWallContinue";
import type { AgentEngineRuntime } from "../../agent-engine/pipeline/runtime";
import type { ToolLoopOutcome } from "../../agent-engine/pipeline/types";
import type { SteeringCriticMode } from "../../agent-engine/steeringFlags";

import type { V8EngineThresholdsOverrides } from "../policy";
import { V8_ENGINE_THRESHOLDS } from "../policy";
import {
  resolveV8LoopPolicyThresholds,
} from "../policy/bands";
import {
  ToolLoopGuard,
  forceFinalToolLoopMessage,
  softToolLoopNudgeMessage,
} from "../actions/toolLoopGuard";
import {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "../actions/truncationRecovery";
import { discardIncompleteToolCalls } from "../actions/completeToolCalls";
import {
  batchIsReadonlyTools,
  requiresMutation,
  softMutationNudgeMessage,
  unfulfilledExecuteNudgeMessage,
} from "../actions/mutationNudge";
import { runV8MutationCritic } from "../actions/mutationCritic";
import { settleToolBatch } from "./settleTools";

function pickV8ThresholdOverrides(
  raw: V8EngineThresholdsOverrides | Record<string, number> | undefined,
): V8EngineThresholdsOverrides | undefined {
  if (!raw) return undefined;
  const next: V8EngineThresholdsOverrides = {};
  for (const key of Object.keys(V8_ENGINE_THRESHOLDS) as Array<
    keyof typeof V8_ENGINE_THRESHOLDS
  >) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) {
      next[key] = value;
    }
  }
  return Object.keys(next).length > 0 ? next : undefined;
}

export type V8ModelLoopParams = {
  runId: string;
  requestId: string;
  interactionMode: AgentMode;
  llm: LlmPort;
  request: ModelRequest;
  decision: ExecutionDecision;
  messages: ModelMessage[];
  bus: EventBus;
  signal: AbortSignal;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  toolCache: ToolCallCache;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  dirtyPaths: readonly string[] | undefined;
  pinnedState: RepositoryStateReference | undefined;
  workspaceRoot: string | undefined;
  taskListRef: TaskListRef;
  evidence?: RunEvidence;
  establishedFacts: EstablishedFact[];
  windowPolicy: WindowPolicy;
  /** Seeded from checkpoint when resuming after Continue. */
  continueOverrideCount?: number;
  /** Host / lab overrides for v8 knobs (merged onto band defaults). */
  thresholdOverrides?: V8EngineThresholdsOverrides | Record<string, number>;
  /** Pre-mutation critic mode from steering (default off). */
  criticMode?: SteeringCriticMode;
  understanding?: RequestUnderstandingResult;
};

/**
 * Thin model/tool loop with Phase 3 discipline:
 * ToolLoopGuard, soft mutation nudge (no evidence spend), truncation/reasoning rails.
 */
export async function runV8ModelLoop(
  runtime: AgentEngineRuntime,
  params: V8ModelLoopParams,
): Promise<ToolLoopOutcome> {
  const {
    runId,
    requestId,
    interactionMode,
    llm,
    request,
    messages,
    bus,
    signal,
    budget,
    reasonCodes,
    warnings,
    toolCache,
    changedFiles,
    mutationCheckpointIds,
    dirtyPaths,
    pinnedState,
    workspaceRoot,
    taskListRef,
    evidence,
    establishedFacts,
    windowPolicy,
  } = params;

  let decision = params.decision;
  let answer = "";
  let truncationRecoveriesUsed = 0;
  let readOnlyTurnsWithoutMutation = 0;
  let unfulfilledExecuteRecoveries = 0;
  const continueOverrideCount = params.continueOverrideCount ?? 0;
  let forceFinalOnly = false;
  const mutationNeeded = requiresMutation(decision);
  const readLedger = new ReadLedger();
  const thresholds = resolveV8LoopPolicyThresholds({
    contextWindowTokens: params.windowPolicy.contextWindowTokens,
    overrides: pickV8ThresholdOverrides(params.thresholdOverrides),
  }).thresholds;
  const criticMode: SteeringCriticMode = params.criticMode ?? "off";
  const toolLoopGuard = new ToolLoopGuard({
    softIdenticalLimit: thresholds.toolLoopSoftIdentical,
    hardIdenticalLimit: thresholds.toolLoopHardIdentical,
    identicalCallAndResultLimit: thresholds.toolLoopIdenticalCallAndResult,
    forcedRejectLimit: thresholds.toolLoopForcedRejectLimit,
  });

  const offerContinue = (
    wallReason: "exploration_stall" | "unfulfilled_execute" | "budget_exhausted",
    partialAnswer: string,
  ): ToolLoopOutcome => {
    const offered = tryOfferBudgetWallContinue({
      wallReason,
      messages,
      toolCache,
      changedFiles,
      mutationCheckpointIds,
      answer: partialAnswer,
      decision,
      continueOverrideCount,
      maxContinueOverrides: thresholds.maxContinueOverrides,
      taskList: taskListRef.current,
      mutationRequired: mutationNeeded,
    });
    if (offered) return offered;
    reasonCodes.push("stall_continue_override_capped");
    return {
      kind: "failed",
      answer: partialAnswer || undefined,
      extraReasons: [],
      error: {
        code:
          wallReason === "unfulfilled_execute"
            ? "no_mutation_performed"
            : "execution_failed",
        message:
          wallReason === "unfulfilled_execute"
            ? "Required mutation was not performed before the continue override cap."
            : "Tool loop exhausted without a recoverable Continue path.",
      },
    };
  };

  while (true) {
    if (signal.aborted) {
      return { kind: "cancelled" };
    }
    if (!budget.canStartModelCall()) {
      return offerContinue(
        "budget_exhausted",
        answer || "Model call budget exhausted.",
      );
    }

    budget.recordModelCall();
    runtime.emitStage(bus, runId, "model_running", "started");

    const offerTools =
      !forceFinalOnly &&
      !toolLoopGuard.isForcingFinalResponse() &&
      decision.toolGrant.allowedTools.length > 0;
    const turnRequest: ModelRequest = {
      ...request,
      messages: [...messages],
      tools: offerTools ? request.tools : undefined,
    };

    const turn = await consumeModelTurn(runtime, {
      llm,
      request: turnRequest,
      runId,
      signal,
      bus,
      maxReasoningCharsWithoutProgress:
        thresholds.maxReasoningCharsWithoutProgress,
    });

    if (turn.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    if (turn.kind === "failed") {
      reasonCodes.push("provider_failed");
      return {
        kind: "failed",
        answer: turn.content || answer || undefined,
        extraReasons: [],
        error: { code: turn.errorCode, message: turn.errorMessage },
      };
    }

    if (turn.usage) {
      budget.addUsage(turn.usage);
    }

    const truncated = turn.finishReason === "length";
    const { complete: toolCalls, discardedCount } = discardIncompleteToolCalls(
      turn.toolCalls,
    );
    if (discardedCount > 0) {
      warnings.push(
        `Discarded ${discardedCount} incomplete truncated tool call(s).`,
      );
    }

    let softNudgeAfterSettle = false;
    if (toolCalls.length > 0) {
      const callDecision = toolLoopGuard.observeCalls(
        toolCalls.map((call) => ({
          name: call.name,
          arguments: call.arguments,
        })),
      );

      if (callDecision.type === "reject") {
        warnings.push(
          `Identical tool batch rejected (${callDecision.violationCount} after force-final).`,
        );
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({
          role: "user",
          content: forceFinalToolLoopMessage(callDecision.violationCount),
        });
        runtime.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
        ]);
        if (callDecision.exhausted) {
          return offerContinue("exploration_stall", turn.content || answer);
        }
        forceFinalOnly = true;
        continue;
      }

      if (callDecision.type === "force_final") {
        warnings.push(
          `Tool loop force-final after ${callDecision.repeatCount} identical batches.`,
        );
        forceFinalOnly = true;
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({
          role: "user",
          content: forceFinalToolLoopMessage(callDecision.repeatCount),
        });
        runtime.emitStage(bus, runId, "model_running", "completed", [
          "model_completed",
        ]);
        continue;
      }

      if (callDecision.type === "soft") {
        softNudgeAfterSettle = true;
        warnings.push(
          `Soft tool-loop nudge after ${callDecision.repeatCount} identical batches.`,
        );
      }
    }

    const recovery = decideTruncationRecovery({
      finishReason: turn.finishReason,
      reasoningBudgetExceeded: turn.reasoningBudgetExceeded === true,
      hasToolCalls: toolCalls.length > 0,
      incompleteToolCalls: discardedCount > 0 && toolCalls.length === 0,
      truncationRecoveriesUsed,
      maxTruncationRecoveries: thresholds.maxTruncationRecoveries,
      requireMutation: mutationNeeded,
    });

    if (recovery.resetCounter) {
      truncationRecoveriesUsed = 0;
    }

    if (recovery.kind === "reasoning_abort" && recovery.shouldRecover) {
      warnings.push(
        truncationWarningMessage({ reasoningBudgetExceeded: true }),
      );
      reasonCodes.push("model_completed");
      messages.push({
        role: "assistant",
        content: turn.content || "(reasoning only — no tools or answer)",
      });
      if (recovery.message) {
        messages.push({ role: "user", content: recovery.message });
      }
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
      ]);
      continue;
    }

    if (
      recovery.shouldRecover &&
      (recovery.kind === "text_continuation" || recovery.kind === "tool_call")
    ) {
      truncationRecoveriesUsed += 1;
      reasonCodes.push("output_truncation_recovered");
      warnings.push(truncationWarningMessage({}));
      messages.push({
        role: "assistant",
        content: turn.content,
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      });
      if (recovery.message) {
        messages.push({ role: "user", content: recovery.message });
      }
      runtime.emitStage(bus, runId, "model_running", "completed", [
        "model_completed",
        "output_truncated",
        "output_truncation_recovered",
      ]);
      continue;
    }

    reasonCodes.push("model_completed");
    if (truncated) {
      reasonCodes.push("output_truncated");
    }
    runtime.emitStage(bus, runId, "model_running", "completed", [
      "model_completed",
      ...(truncated ? (["output_truncated"] as const) : []),
    ]);

    if (toolCalls.length > 0) {
      truncationRecoveriesUsed = 0;

      const critic = runV8MutationCritic({
        decision,
        toolCalls,
        turnContent: turn.content,
        mode: criticMode,
        understanding: params.understanding,
      });
      if (critic.result.shadowWouldBlock) {
        reasonCodes.push("mutation_critic_shadow_block");
        warnings.push(
          `Mutation critic (shadow) would block: ${critic.result.reasons.join(" ")}`,
        );
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: `Mutation critic shadow: ${critic.result.reasons[0] ?? "would block"}`,
          at: runtime.isoNow(),
        });
      }
      if (critic.kind === "revise") {
        reasonCodes.push("mutation_critic_revise");
        if (
          critic.result.narrowToPaths &&
          critic.result.narrowToPaths.length > 0 &&
          runtime.deps.decision.narrow
        ) {
          decision = runtime.deps.decision.narrow({
            previous: decision,
            discoveredPaths: critic.result.narrowToPaths,
          });
          reasonCodes.push("grant_narrowed");
        }
        warnings.push(
          `Mutation critic revise: ${critic.result.reasons.join(" ")}`,
        );
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({ role: "user", content: critic.message });
        continue;
      }
      if (critic.kind === "stop") {
        reasonCodes.push("mutation_critic_stop");
        warnings.push(
          `Mutation critic stop: ${critic.result.reasons.join(" ")}`,
        );
        messages.push({
          role: "assistant",
          content: turn.content,
          toolCalls,
        });
        messages.push({ role: "user", content: critic.message });
        continue;
      }
      if (
        critic.kind === "pass" &&
        !critic.result.shadowWouldBlock &&
        criticMode !== "off"
      ) {
        reasonCodes.push("mutation_critic_pass");
      }

      const settled = await settleToolBatch({
        runtime,
        runId,
        requestId,
        interactionMode,
        bus,
        signal,
        decision,
        toolCalls,
        turnContent: turn.content,
        messages,
        toolCache,
        readLedger,
        budget,
        warnings,
        reasonCodes,
        dirtyPaths,
        pinnedState,
        workspaceRoot,
        changedFiles,
        mutationCheckpointIds,
        taskListRef,
        evidence,
        establishedFacts,
        windowPolicy,
        answer,
        toolLoopGuard,
      });
      if (settled.kind === "return") {
        return settled.outcome;
      }
      decision = settled.decision;

      if (softNudgeAfterSettle) {
        messages.push({
          role: "user",
          content: softToolLoopNudgeMessage(thresholds.toolLoopSoftIdentical),
        });
      }

      if (settled.stats.succeededMutating) {
        readOnlyTurnsWithoutMutation = 0;
        unfulfilledExecuteRecoveries = 0;
      } else if (mutationNeeded && batchIsReadonlyTools(toolCalls)) {
        readOnlyTurnsWithoutMutation += 1;
        if (
          readOnlyTurnsWithoutMutation >=
          thresholds.maxReadOnlyTurnsBeforeMutationNudge
        ) {
          warnings.push(
            `Soft mutation nudge after ${readOnlyTurnsWithoutMutation} read-only turns.`,
          );
          messages.push({
            role: "user",
            content: softMutationNudgeMessage(readOnlyTurnsWithoutMutation),
          });
          readOnlyTurnsWithoutMutation = 0;
        }
      }

      if (toolLoopGuard.isForcingFinalResponse()) {
        forceFinalOnly = true;
        messages.push({
          role: "user",
          content: forceFinalToolLoopMessage(
            thresholds.toolLoopIdenticalCallAndResult,
          ),
        });
      }

      continue;
    }

    answer = turn.content;
    messages.push({ role: "assistant", content: turn.content });

    if (mutationNeeded && changedFiles.length === 0) {
      unfulfilledExecuteRecoveries += 1;
      if (
        unfulfilledExecuteRecoveries <=
        thresholds.maxUnfulfilledExecuteRecoveries
      ) {
        warnings.push("Unfulfilled execute: nudging for apply_patch.");
        messages.push({
          role: "user",
          content: unfulfilledExecuteNudgeMessage(),
        });
        continue;
      }
      return offerContinue("unfulfilled_execute", answer);
    }

    if (changedFiles.length > 0) {
      reasonCodes.push("mutation_applied");
    }
    if (answer.trim().length > 0) {
      reasonCodes.push("answer_produced");
    }

    return {
      kind: "completed",
      answer,
      changedFiles,
      mutationCheckpointIds,
      messages,
      toolCache,
      decision,
    };
  }
}
