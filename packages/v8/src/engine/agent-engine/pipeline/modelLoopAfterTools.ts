import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
  ModelMessage,
  ModelToolCall,
} from "../../../modules/model-gateway";

import {
  buildExplorationStallNudge,
  buildUnfulfilledExecuteRecoveryMessage,
  buildRejectedMutationRecoveryMessage,
  buildRejectedToolRecoveryMessage,
  allowsTargetedDiscoveryAfterRejectedMutation,
  isTargetedDiscoveryAfterRejectedMutation,
  applyExplorationSignal,
  isExplorationRereadHeavy,
  resetLoopFileReadTracker,
  snapshotLoopFileReads,
  isTransitionalAssistantAnswer,
  synthesizeFallbackAnswer,
  buildStallContinueRationale,
  shouldOfferStallContinue,
} from "../actions";
import type { LoopFileReadTracker } from "../actions";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import type { ToolCallCache } from "../internal/ToolCallCache";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineThresholds } from "../actions/resolveAgentEngineThresholds";

import type { AgentEngineRuntime } from "./runtime";
import type { ModelLoopSession } from "./modelLoopSession";
import type { ModelLoopStepResult } from "./modelLoopStep";
import type { ToolPhaseBatchStats } from "./modelLoopToolPhase";

export function resolveModelLoopAfterTools(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  bus: EventBus;
  session: ModelLoopSession;
  decision: ExecutionDecision;
  grant: ExecutionDecision["toolGrant"];
  toolCalls: readonly ModelToolCall[];
  stats: ToolPhaseBatchStats;
  isMutationRequired: () => boolean;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  thresholds: AgentEngineThresholds;
  taskListRef: TaskListRef;
  loopFileReads: LoopFileReadTracker;
  logVerbosity: AgentLogVerbosity;
}): ModelLoopStepResult {
  const {
    runtime,
    runId,
    bus,
    session,
    decision,
    grant,
    toolCalls,
    stats,
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
  } = params;
  const {
    attemptedMutatingTool,
    succeededMutatingTool,
    successfulToolCount,
    rejectedToolCount,
    rejectedMutation,
    rejectedTool,
  } = stats;
  let answer = session.answer;

  reasonCodes.push("tools_executed");
  runtime.emitStage(bus, runId, "tool_running", "completed", [
    "tools_executed",
  ]);

  if (
    isMutationRequired() &&
    changedFiles.length === 0 &&
    session.awaitingRejectedMutationRetry &&
    !attemptedMutatingTool
  ) {
    if (
      isTargetedDiscoveryAfterRejectedMutation({
        recovery: session.awaitingRejectedMutationRetry,
        toolCalls,
        successfulToolCount,
        rejectedToolCount,
      })
    ) {
      const used =
        session.awaitingRejectedMutationRetry.targetedDiscoveryToolCallsUsed +
        toolCalls.length;
      const max =
        session.awaitingRejectedMutationRetry.maxTargetedDiscoveryToolCalls;
      session.awaitingRejectedMutationRetry = {
        ...session.awaitingRejectedMutationRetry,
        targetedDiscoveryToolCallsUsed: used,
        allowTargetedDiscovery: used < max,
      };
      messages.push({
        role: "user",
        content:
          `Use that targeted discovery result to retry the corrected workspace edit now. Targeted stale-patch reads used: ${used}/${max}. Your next turn must call apply_patch/delete_file/move_file or stop with a clear blocker. Only read again if it is one of the exact stale patch files and still within this budget.`,
      });
      warnings.push(
        "Allowed targeted stale-patch discovery after a recoverable rejected mutation.",
      );
      session.answer = answer;
      return { kind: "continue" };
    }

    reasonCodes.push("tool_failed", "unfulfilled_execute_exhausted");
    session.answer = answer;
      return { kind: "return", outcome: {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: [],
      error: {
        code: "no_mutation_performed",
        message:
          "The model read more files after a rejected mutation instead of retrying the workspace edit.",
      },
    } };
  }

  if (
    isMutationRequired() &&
    changedFiles.length === 0 &&
    session.awaitingReadOnlyMutationRetry &&
    !attemptedMutatingTool
  ) {
    if (session.mutationBlockerAsked) {
      reasonCodes.push("unfulfilled_execute_exhausted");
      session.answer = answer;
      return { kind: "return", outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: [],
        error: {
          code: "no_mutation_performed",
          message:
            "The model continued reading after being told to apply the required workspace edit.",
        },
      } };
    }

    if (
      session.readOnlyMutationRetryAttempts <
        thresholds.maxReadOnlyMutationRetryAttempts &&
      budget.canStartModelCall()
    ) {
      session.readOnlyMutationRetryAttempts += 1;
      reasonCodes.push("unfulfilled_execute_recovered");
      messages.push({
        role: "user",
        content:
          "You read again instead of editing. Prefer apply_patch/delete_file/move_file with a bounded change on your next turn. You may use a few more targeted read_file/read_many_files turns for active-row write/mustRead paths only; broad list/glob/search rediscovery will fail the run. Or stop with a clear blocker.\n\n" +
          buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
      });
      warnings.push(
        "Model kept reading after the first-mutation nudge; granting another bounded chance before failing the run.",
      );
      session.answer = answer;
      return { kind: "continue" };
    }

    if (budget.canStartModelCall()) {
      session.mutationBlockerAsked = true;
      reasonCodes.push("unfulfilled_execute_recovered");
      messages.push({
        role: "user",
        content:
          "Do not call any tools on this turn. Either call apply_patch/delete_file/move_file with a bounded change, or stop with a clear blocker explaining why no workspace edit can fix this (missing config, credentials, external API, or similar). Searching or reading again will fail the run.",
      });
      warnings.push(
        "Read-only drift exhausted; requesting a mutation or an explicit blocker with no further discovery tools.",
      );
      session.answer = answer;
      return { kind: "continue" };
    }

    reasonCodes.push("unfulfilled_execute_exhausted");
    session.answer = answer;
      return { kind: "return", outcome: {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: [],
      error: {
        code: "no_mutation_performed",
        message:
          "The model continued reading after being told to apply the required workspace edit.",
      },
    } };
  }

  if (
    isMutationRequired() &&
    changedFiles.length === 0 &&
    !attemptedMutatingTool &&
    rejectedTool &&
    successfulToolCount === 0 &&
    rejectedToolCount === toolCalls.length
  ) {
    reasonCodes.push("tool_failed");
    if (
      session.rejectedToolRecoveries <
        thresholds.maxUnfulfilledExecuteRecoveries &&
      budget.canStartModelCall()
    ) {
      session.rejectedToolRecoveries += 1;
      messages.push({
        role: "user",
        content: buildRejectedToolRecoveryMessage(rejectedTool),
      });
      warnings.push(
        `All requested tools were ${rejectedTool.status}; requesting corrected tool arguments or a patch.`,
      );
      session.answer = answer;
      return { kind: "continue" };
    }

    reasonCodes.push("unfulfilled_execute_exhausted");
    session.answer = answer;
      return { kind: "return", outcome: {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: [],
      error: {
        code: "no_mutation_performed",
        message:
          "The model repeatedly called rejected tools instead of applying the required workspace edits.",
      },
    } };
  }

  if (
    isMutationRequired() &&
    changedFiles.length === 0 &&
    rejectedMutation
  ) {
    reasonCodes.push("tool_failed");
    if (
      session.rejectedMutationRecoveries <
        thresholds.maxRejectedMutationRecoveries &&
      budget.canStartModelCall()
    ) {
      session.rejectedMutationRecoveries += 1;
      const maxTargetedDiscoveryToolCalls =
        grant.mutationBudget?.maxUniqueFilesPerCall ??
        thresholds.defaultPreferredBatchSize;
      const allowTargetedDiscovery =
        allowsTargetedDiscoveryAfterRejectedMutation(rejectedMutation);
      session.awaitingRejectedMutationRetry = {
        allowTargetedDiscovery,
        targetedDiscoveryToolCallsUsed: 0,
        maxTargetedDiscoveryToolCalls,
      };
      messages.push({
        role: "user",
        content: buildRejectedMutationRecoveryMessage({
          ...rejectedMutation,
          maxTargetedDiscoveryToolCalls,
          defaultPreferredBatchSize: thresholds.defaultPreferredBatchSize,
        }),
      });
      warnings.push(
        `Mutation tool ${rejectedMutation.toolName} ${rejectedMutation.status}; requesting a corrected edit.`,
      );
      session.answer = answer;
      return { kind: "continue" };
    }

    reasonCodes.push("unfulfilled_execute_exhausted");
    session.answer = answer;
      return { kind: "return", outcome: {
      kind: "failed",
      answer: answer || undefined,
      extraReasons: [],
      error: {
        code: "no_mutation_performed",
        message:
          "The model could not apply a valid workspace edit after a rejected mutation attempt.",
      },
    } };
  }

  if (attemptedMutatingTool) {
    session.awaitingRejectedMutationRetry = undefined;
    session.awaitingReadOnlyMutationRetry = false;
    session.readOnlyToolTurnsWithoutMutation = 0;
    session.readOnlyMutationRetryAttempts = 0;
    session.mutationBlockerAsked = false;
    if (succeededMutatingTool) {
      session.readOnlyToolTurnsAfterMutation = 0;
      resetLoopFileReadTracker(loopFileReads);
      session.explorationStallNudges = 0;
      session.postNudgeEvidenceReadTurns = 0;
      // Drop stale recovery/blocker narration once disk edits exist.
      if (
        changedFiles.length > 0 &&
        (answer.trim().length === 0 ||
          isTransitionalAssistantAnswer(answer) ||
          /(?:^|\n)\s*(?:\*{0,2}|_{0,2})?\s*blocker(?:\*{0,2}|_{0,2})?\s*[:\-—]/im.test(
            answer,
          ) ||
          /\b(?:stop(?:ping)?\s+here\s+with\s+a\s+clear\s+blocker|have\s+to\s+stop\s+here\s+with\s+a\s+clear\s+blocker)\b/i.test(
            answer,
          ))
      ) {
        answer = synthesizeFallbackAnswer({
          priorAnswer: answer,
          changedFiles,
        });
      }
    }
  } else if (
    isMutationRequired() &&
    changedFiles.length === 0 &&
    successfulToolCount > 0
  ) {
    session.readOnlyToolTurnsWithoutMutation += 1;
    if (
      session.readOnlyToolTurnsWithoutMutation >=
      thresholds.maxReadOnlyToolTurnsBeforeMutationNudge
    ) {
      if (budget.canStartModelCall()) {
        session.awaitingReadOnlyMutationRetry = true;
        reasonCodes.push("unfulfilled_execute_recovered");
        messages.push({
          role: "user",
          content:
            "You have enough repository context to attempt the requested edit. Prefer apply_patch/delete_file/move_file now. If an active checklist write/mustRead path is still missing from evidence, you may use a few targeted read_file/read_many_files turns, then patch. Do not start broad rediscovery. Or stop with a clear blocker.\n\n" +
            buildUnfulfilledExecuteRecoveryMessage(grant.mutationBudget),
        });
        warnings.push(
          "Execute route spent multiple tool turns reading without edits; requesting the first mutation.",
        );
        session.answer = answer;
      return { kind: "continue" };
      }

      reasonCodes.push("unfulfilled_execute_exhausted");
      session.answer = answer;
      return { kind: "return", outcome: {
        kind: "failed",
        answer: answer || undefined,
        extraReasons: ["unfulfilled_execute_exhausted"],
        error: {
          code: "no_mutation_performed",
          message:
            "The model repeatedly read files but did not apply the required workspace edits.",
        },
      } };
    }
  } else if (
    changedFiles.length > 0 &&
    successfulToolCount > 0 &&
    !attemptedMutatingTool
  ) {
    session.readOnlyToolTurnsAfterMutation += 1;
    if (
      session.readOnlyToolTurnsAfterMutation >=
      thresholds.maxReadOnlyToolTurnsAfterMutationNudge
    ) {
      if (
        session.afterMutationReadOnlyNudges <
          thresholds.maxReadOnlyToolTurnsAfterMutationNudges &&
        budget.canStartModelCall()
      ) {
        session.afterMutationReadOnlyNudges += 1;
        session.readOnlyToolTurnsAfterMutation = 0;
        reasonCodes.push("unfulfilled_execute_recovered");
        messages.push({
          role: "user",
          content:
            "Stop globbing/searching. Continue apply_patch for remaining errors, or run typecheck/diagnostics. Do not start a new exploration pass.",
        });
        warnings.push(
          "Execute route spent multiple tool turns reading after mutations; requesting the next patch or verification.",
        );
        session.answer = answer;
      return { kind: "continue" };
      }

      reasonCodes.push("post_mutation_read_capped");
      warnings.push(
        "Stopped further read-only turns after mutations so verification can use remaining model-call budget.",
      );
      if (
        changedFiles.length > 0 &&
        (answer.trim().length === 0 || isTransitionalAssistantAnswer(answer))
      ) {
        answer = synthesizeFallbackAnswer({
          priorAnswer: answer,
          changedFiles,
        });
        reasonCodes.push("incomplete_answer_fallback");
      }
      session.answer = answer;
      return { kind: "return", outcome: {
        kind: "completed",
        answer,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        decision,
      } };
    }
  }

  const loopUsageSnap = snapshotLoopFileReads(loopFileReads);
  if (isExplorationRereadHeavy(loopUsageSnap, thresholds)) {
    applyExplorationSignal(loopUsageSnap, reasonCodes, warnings, thresholds);
    if (
      session.explorationStallNudges <
      thresholds.maxExplorationStallNudges
    ) {
      session.explorationStallNudges += 1;
      if (logVerbosityAtLeast(logVerbosity, "verbose")) {
        // Live signal while the run is still in progress — the array
        // pushes above only surface in the terminal result's warnings.
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: `File reads (${loopUsageSnap.fileReadCalls}) substantially exceeded unique paths (${loopUsageSnap.uniqueFilePathsTouched}); nudging the model (attempt ${session.explorationStallNudges}).`,
          code: "exploration_reread_heavy",
          data: {
            fileReadCalls: loopUsageSnap.fileReadCalls,
            uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
            nudgeAttempt: session.explorationStallNudges,
          },
          at: runtime.isoNow(),
        });
      }
      messages.push({
        role: "user",
        content: buildExplorationStallNudge(loopUsageSnap, {
          mutationRequired:
            isMutationRequired() && changedFiles.length === 0,
        }),
      });
    } else {
      reasonCodes.push("exploration_stall_broken");
      warnings.push(
        "Stopped the run after repeated file re-reads of the same paths.",
      );
      if (logVerbosityAtLeast(logVerbosity, "standard")) {
        runtime.emit(bus, {
          type: "warning",
          runId,
          message: "Stopped the run after repeated file re-reads of the same paths.",
          code: "exploration_stall_broken",
          data: {
            fileReadCalls: loopUsageSnap.fileReadCalls,
            uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
          },
          at: runtime.isoNow(),
        });
      }
      if (isMutationRequired() && changedFiles.length === 0) {
        session.answer = answer;
      return { kind: "return", outcome: {
          kind: "failed",
          answer: answer || undefined,
          extraReasons: ["unfulfilled_execute_exhausted"],
          error: {
            code: "no_mutation_performed",
            message:
              "The model repeatedly read files but did not apply the required workspace edits.",
          },
        } };
      }
      if (
        shouldOfferStallContinue({
          changedFiles,
          taskList: taskListRef.current,
          mutationRequired: isMutationRequired(),
        })
      ) {
        const rationale = buildStallContinueRationale({
          changedFiles,
          taskList: taskListRef.current,
          answer,
          fileReadCalls: loopUsageSnap.fileReadCalls,
          uniqueFilePathsTouched: loopUsageSnap.uniqueFilePathsTouched,
        });
        session.answer = answer;
      return { kind: "return", outcome: {
          kind: "continue_required",
          messages,
          toolCache,
          rationale,
          changedFiles,
          mutationCheckpointIds,
          answer,
          decision,
        } };
      }
      session.answer = answer;
      return { kind: "return", outcome: {
        kind: "completed",
        answer,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        decision,
      } };
    }
  }

  session.answer = answer;
  return { kind: "continue" };
}
