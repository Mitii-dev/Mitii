import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelMessage, ModelToolCall } from "../../../modules/model-gateway";

import type { AgentReasonCode, RunEvidence } from "../contracts";
import type { LoopFileReadTracker } from "../actions";
import { synthesizeFallbackAnswer } from "../actions/isIncompleteAssistantTurn";
import { shouldFinishAfterVerifiedMutation } from "../actions/shouldFinishAfterVerifiedMutation";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import { ToolCallCache } from "../internal/ToolCallCache";
import {
  forceFinalToolLoopMessage,
  softToolLoopNudgeMessage,
  type ToolLoopGuard,
} from "../modules/tool-loop-guard";
import {
  batchIsReadonlyTools,
  changeImpactRetryPatchMessage,
  readonlyThrashPartialAnswer,
  shouldEscalateReadonlyThrashToContinue,
  softMutationNudgeMessage,
} from "../modules/mutation-nudge";
import {
  buildEvidenceRecoveryMessage,
  buildStepEvidenceGateMessage,
  buildStepPatchRequiredMessage,
  decideMutateEvidenceAction,
  evaluateActiveStepMutateReadiness,
  resolveMutateLockAllowTargetedReads,
  type MutateReadinessBudget,
} from "../modules/mutate-readiness";
import { buildRejectedMutationRecoveryMessage } from "../modules/rejected-mutation";
import {
  DIAGNOSE_ANSWER_NUDGE_MESSAGE,
  primaryToolNameIfUniform,
  shouldLockDiagnoseAnswer,
  shouldNudgeDiagnoseAnswer,
  updateRepeatedReadonlyToolTurns,
} from "../modules/diagnose-answer";
import { finishEvidenceRailExhausted } from "./modelLoopSupport";
import type { SettleToolsResult } from "./settleTools";
import type { AgentEngineRuntime } from "./runtime";
import type { ToolLoopOutcome } from "./types";

export type AfterToolSettleState = {
  decision: ExecutionDecision;
  answer: string;
  gitWriteSucceeded: boolean;
  readOnlyTurnsWithoutMutation: number;
  readonlyTurnsOnActiveStep: number;
  unfulfilledExecuteRecoveries: number;
  rejectedMutationRecoveries: number;
  softMutationNudges: number;
  evidenceGateNudges: number;
  evidenceRecoveryUsed: boolean;
  reasoningAbortRecoveriesUsed: number;
  awaitingMutateOnly: boolean;
  mutateLockAllowTargetedReads: boolean;
  consecutiveSameToolTurns: number;
  lastUniformToolName: string | undefined;
  lastActiveStepId: string | undefined;
  awaitingAnswerOnly: boolean;
  forceFinalOnly: boolean;
  diagnoseAnswerNudges: number;
};

export type AdvanceAfterToolSettleResult = {
  state: AfterToolSettleState;
} & ({ kind: "continue" } | { kind: "done"; outcome: ToolLoopOutcome });

/**
 * After a settled tool batch: finish-after-verified, soft nudge, mutate/readonly
 * rails, diagnose answer lock, and tool-loop force-final.
 */
export function advanceAfterToolSettle(params: {
  runtime: AgentEngineRuntime;
  bus: EventBus;
  runId: string;
  settled: Extract<SettleToolsResult, { kind: "continue" }>;
  softNudgeAfterSettle: boolean;
  toolCalls: readonly ModelToolCall[];
  turnContent: string;
  messages: ModelMessage[];
  toolCache: ToolCallCache;
  toolLoopGuard: ToolLoopGuard;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  taskListRef: TaskListRef;
  evidence: RunEvidence | undefined;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  mutationNeeded: boolean;
  vcsHistoryRewrite: boolean;
  planDraftedThisRun: boolean;
  seedTrusted: boolean;
  stepReadonlyTurnsBeforeGate: number;
  readonlyTurnsBeforeMutationNudge: number;
  mutateReadinessBudget: MutateReadinessBudget;
  changeImpactGate: {
    required: boolean;
    satisfied: boolean;
    lastImpactAffectedFiles?: string[];
    lastWidenVerification?: boolean;
  };
  evaluateStepReadiness: () => ReturnType<typeof evaluateActiveStepMutateReadiness>;
  loopFileReads: LoopFileReadTracker;
  thresholds: {
    toolLoopSoftIdentical: number;
    toolLoopIdenticalCallAndResult: number;
    maxRejectedMutationRecoveries: number;
    preferredBatchSize: number;
    maxSoftMutationNudgesBeforeContinue: number;
    maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: number;
    maxDiagnoseAnswerNudges: number;
  };
  offerContinue: (
    wallReason:
      | "exploration_stall"
      | "unfulfilled_execute"
      | "budget_exhausted"
      | "evidence_clarify"
      | "provider_unavailable",
    partialAnswer: string,
  ) => ToolLoopOutcome;
  state: AfterToolSettleState;
}): AdvanceAfterToolSettleResult {
  const {
    runtime,
    bus,
    runId,
    settled,
    softNudgeAfterSettle,
    toolCalls,
    turnContent,
    messages,
    toolCache,
    toolLoopGuard,
    changedFiles,
    mutationCheckpointIds,
    taskListRef,
    evidence,
    budget,
    reasonCodes,
    warnings,
    mutationNeeded,
    vcsHistoryRewrite,
    planDraftedThisRun,
    seedTrusted,
    stepReadonlyTurnsBeforeGate,
    readonlyTurnsBeforeMutationNudge,
    mutateReadinessBudget,
    changeImpactGate,
    evaluateStepReadiness,
    loopFileReads,
    thresholds,
    offerContinue,
  } = params;

  let {
    decision,
    answer,
    gitWriteSucceeded,
    readOnlyTurnsWithoutMutation,
    readonlyTurnsOnActiveStep,
    unfulfilledExecuteRecoveries,
    rejectedMutationRecoveries,
    softMutationNudges,
    evidenceGateNudges,
    evidenceRecoveryUsed,
    reasoningAbortRecoveriesUsed,
    awaitingMutateOnly,
    mutateLockAllowTargetedReads,
    consecutiveSameToolTurns,
    lastUniformToolName,
    lastActiveStepId,
    awaitingAnswerOnly,
    forceFinalOnly,
    diagnoseAnswerNudges,
  } = params.state;

  const snapshot = (): AfterToolSettleState => ({
    decision,
    answer,
    gitWriteSucceeded,
    readOnlyTurnsWithoutMutation,
    readonlyTurnsOnActiveStep,
    unfulfilledExecuteRecoveries,
    rejectedMutationRecoveries,
    softMutationNudges,
    evidenceGateNudges,
    evidenceRecoveryUsed,
    reasoningAbortRecoveriesUsed,
    awaitingMutateOnly,
    mutateLockAllowTargetedReads,
    consecutiveSameToolTurns,
    lastUniformToolName,
    lastActiveStepId,
    awaitingAnswerOnly,
    forceFinalOnly,
    diagnoseAnswerNudges,
  });

  const done = (outcome: ToolLoopOutcome): AdvanceAfterToolSettleResult => ({
    kind: "done",
    outcome,
    state: snapshot(),
  });
  const cont = (): AdvanceAfterToolSettleResult => ({
    kind: "continue",
    state: snapshot(),
  });

    if (
      shouldFinishAfterVerifiedMutation({
        mutationApplied: changedFiles.length > 0 || gitWriteSucceeded ||
          settled.stats.succeededGitWrite,
        batchHadSuccessfulMutation:
          settled.stats.succeededMutating || settled.stats.succeededGitWrite,
        batchHadRejectedMutation: settled.stats.rejectedMutation !== undefined,
        openTaskCount: (taskListRef.current?.items ?? []).filter(
          (item) => item.status === "pending" || item.status === "active",
        ).length,
        batch: toolCalls.map((call) => ({
          toolName: call.name,
          result: toolCache.get(call.id),
        })),
      })
    ) {
      // Verification passed after the last edit: end the loop; the
      // verification gate decides. No extra free-form narration turn.
      reasonCodes.push("loop_finished_after_verified_mutation", "mutation_applied");
      if (answer.trim().length === 0) {
        answer = synthesizeFallbackAnswer({
          priorAnswer: turnContent,
          changedFiles,
        });
      }
      return done({
        kind: "completed",
        answer,
        changedFiles,
        mutationCheckpointIds,
        messages,
        toolCache,
        decision,
      });
    }

    if (softNudgeAfterSettle) {
      messages.push({
        role: "user",
        content: softToolLoopNudgeMessage(thresholds.toolLoopSoftIdentical),
      });
    }

    if (settled.stats.succeededMutating || settled.stats.succeededGitWrite) {
      if (settled.stats.succeededGitWrite) {
        gitWriteSucceeded = true;
      }
      readOnlyTurnsWithoutMutation = 0;
      readonlyTurnsOnActiveStep = 0;
      unfulfilledExecuteRecoveries = 0;
      rejectedMutationRecoveries = 0;
      softMutationNudges = 0;
      evidenceGateNudges = 0;
      reasoningAbortRecoveriesUsed = 0;
      awaitingMutateOnly = false;
      mutateLockAllowTargetedReads = true;
      consecutiveSameToolTurns = 0;
      lastUniformToolName = undefined;
    } else if (
      mutationNeeded &&
      changedFiles.length === 0 &&
      !gitWriteSucceeded &&
      changeImpactGate.required &&
      changeImpactGate.satisfied &&
      toolCalls.some(
        (call) =>
          call.name === "analyze_change_impact" ||
          call.name === "plan_check_change_impact",
      )
    ) {
      // Gate just satisfied (or already was): demand the withheld patch this
      // turn — do not count this as readonly thrash / Continue.
      softMutationNudges = 0;
      readOnlyTurnsWithoutMutation = 0;
      readonlyTurnsOnActiveStep = 0;
      awaitingMutateOnly = true;
      mutateLockAllowTargetedReads = false;
      reasonCodes.push("step_mutate_patch_required", "step_mutate_lock_armed");
      warnings.push(
        "Change impact satisfied; mutate lock demanding apply_patch retry.",
      );
      runtime.emit(bus, {
        type: "warning",
        runId,
        message:
          "Mutate lock: discovery stripped; call apply_patch now (targeted reads off). Edits are not done until it lands.",
        at: runtime.isoNow(),
      });
      messages.push({
        role: "user",
        content: changeImpactRetryPatchMessage(),
      });
    } else if (
      mutationNeeded &&
      changedFiles.length === 0 &&
      !gitWriteSucceeded &&
      settled.stats.rejectedMutation &&
      rejectedMutationRecoveries < thresholds.maxRejectedMutationRecoveries &&
      budget.canStartModelCall()
    ) {
      rejectedMutationRecoveries += 1;
      const rejected = settled.stats.rejectedMutation;
      const maxTargetedDiscoveryToolCalls =
        decision.toolGrant.mutationBudget?.maxUniqueFilesPerCall ??
        thresholds.preferredBatchSize;
      reasonCodes.push("tool_failed");
      warnings.push(
        `Mutation tool ${rejected.toolName} ${rejected.status}; requesting a corrected edit.`,
      );
      messages.push({
        role: "user",
        content: buildRejectedMutationRecoveryMessage({
          ...rejected,
          maxTargetedDiscoveryToolCalls,
          defaultPreferredBatchSize: thresholds.preferredBatchSize,
        }),
      });
    } else if (mutationNeeded && batchIsReadonlyTools(toolCalls)) {
      const activeStep = taskListRef.current?.items.find(
        (item) => item.status === "active",
      );
      const activeStepId = activeStep?.id;
      if (activeStepId !== lastActiveStepId) {
        lastActiveStepId = activeStepId;
        readonlyTurnsOnActiveStep = 0;
        evidenceGateNudges = 0;
        evidenceRecoveryUsed = false;
      }
      readOnlyTurnsWithoutMutation += 1;
      readonlyTurnsOnActiveStep += 1;

      const gateTurns = Math.min(
        stepReadonlyTurnsBeforeGate,
        readonlyTurnsBeforeMutationNudge,
      );
      if (readonlyTurnsOnActiveStep >= gateTurns) {
        const readiness = evaluateStepReadiness();
        const evidenceAction = decideMutateEvidenceAction({
          readiness,
          seedTrusted,
          evidenceGateNudges,
          maxEvidenceGateNudges:
            mutateReadinessBudget.maxEvidenceGateNudgesBeforePatchDemand,
          recoveryAlreadyUsed: evidenceRecoveryUsed,
          maxRecoveryPaths: mutateReadinessBudget.evidenceRecoveryMaxPaths,
        });

        if (evidenceAction.kind === "EVIDENCE_GATE") {
          evidenceGateNudges += 1;
          reasonCodes.push("step_mutate_readiness_gated", "step_mutate_lock_armed");
          awaitingMutateOnly = true;
          mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
            readinessReady: false,
            evidenceGateActive: true,
          });
          const gateMessage = buildStepEvidenceGateMessage(readiness);
          warnings.push(
            `Step evidence gate: ${readiness.missingPaths.length} path(s) still needed before patch.`,
          );
          runtime.emit(bus, {
            type: "warning",
            runId,
            message: `Step evidence gate for "${readiness.activeTitle ?? readiness.activeItemId ?? "active step"}"; discovery stripped — targeted reads then patch. Edits are not done.`,
            at: runtime.isoNow(),
          });
          messages.push({ role: "user", content: gateMessage });
          readonlyTurnsOnActiveStep = 0;
          readOnlyTurnsWithoutMutation = 0;
        } else if (evidenceAction.kind === "RECOVERY_REQUIRED") {
          evidenceRecoveryUsed = true;
          evidenceGateNudges = 0;
          reasonCodes.push(
            "evidence_recovery_armed",
            "step_mutate_readiness_gated",
            "step_mutate_lock_armed",
          );
          awaitingMutateOnly = true;
          mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
            readinessReady: false,
            evidenceGateActive: true,
          });
          const recoveryPaths = evidenceAction.recoveryPaths ?? evidenceAction.missingPaths;
          warnings.push(
            `Evidence recovery: ${recoveryPaths.length} local path(s); no open-world search.`,
          );
          messages.push({
            role: "user",
            content: buildEvidenceRecoveryMessage({
              paths: recoveryPaths,
              recoveryTurns: mutateReadinessBudget.evidenceRecoveryTurns,
            }),
          });
          readonlyTurnsOnActiveStep = 0;
          readOnlyTurnsWithoutMutation = 0;
        } else if (evidenceAction.kind === "INSUFFICIENT_EVIDENCE") {
          if (evidenceAction.reason === "weak_seed") {
            softMutationNudges += 1;
            reasonCodes.push("execution_seed_weak", "soft_mutation_nudged");
            warnings.push(
              "No trusted execution seed yet — not demanding apply_patch after readonly thrash.",
            );
            readonlyTurnsOnActiveStep = 0;
            readOnlyTurnsWithoutMutation = 0;
            if (
              shouldEscalateReadonlyThrashToContinue({
                softMutationNudges,
                maxSoftMutationNudgesBeforeContinue:
                  thresholds.maxSoftMutationNudgesBeforeContinue,
                changedFileCount: changedFiles.length,
                gitWriteSucceeded,
              })
            ) {
              reasonCodes.push("readonly_thrash_continue");
              return done(offerContinue(
                "evidence_clarify",
                "No trusted file seed yet, so no workspace edits were applied. Continue with an explicit path or stop here.",
              ));
            }
          } else {
            return done(finishEvidenceRailExhausted({
              reason:
                evidenceAction.reason === "recovery_exhausted"
                  ? "recovery_exhausted"
                  : "miss_not_local",
              reasonCodes,
              warnings,
              runtime,
              bus,
              runId,
              evidence,
              budget: mutateReadinessBudget,
              nudgesUsed: evidenceGateNudges,
              recoveryUsed: evidenceRecoveryUsed,
              readonlyTurnsOnStep:
                readonlyTurnsOnActiveStep || gateTurns,
            }));
          }
        } else {
          // PATCH_READY
          softMutationNudges += 1;
          reasonCodes.push(
            "step_mutate_patch_required",
            "step_mutate_lock_armed",
          );
          awaitingMutateOnly = true;
          mutateLockAllowTargetedReads = resolveMutateLockAllowTargetedReads({
            readinessReady: true,
            evidenceGateActive: false,
          });
          const patchMessage =
            readiness.activeItemId || readiness.writePaths.length > 0
              ? buildStepPatchRequiredMessage(readiness)
              : softMutationNudgeMessage(
                  readonlyTurnsOnActiveStep || gateTurns,
                  {
                    vcsHistoryRewrite,
                    hasPlan: planDraftedThisRun,
                  },
                );
          warnings.push(
            `Step patch demand after ${gateTurns} read-only turns on active step (mutate lock armed).`,
          );
          runtime.emit(bus, {
            type: "warning",
            runId,
            message:
              "Mutate lock: discovery stripped; call apply_patch now (targeted reads off). Edits are not done until it lands.",
            at: runtime.isoNow(),
          });
          messages.push({ role: "user", content: patchMessage });
          readonlyTurnsOnActiveStep = 0;
          readOnlyTurnsWithoutMutation = 0;

          if (
            shouldEscalateReadonlyThrashToContinue({
              softMutationNudges,
              maxSoftMutationNudgesBeforeContinue:
                thresholds.maxSoftMutationNudgesBeforeContinue,
              changedFileCount: changedFiles.length,
              gitWriteSucceeded,
            })
          ) {
            reasonCodes.push("readonly_thrash_continue");
            warnings.push(
              "Read-only thrash after soft mutation nudges; offering Continue without claiming edits are done.",
            );
            return done(offerContinue(
              "unfulfilled_execute",
              readonlyThrashPartialAnswer({
                hasPlan: planDraftedThisRun,
                fileReadCalls: loopFileReads.calls,
              }),
            ));
          }
        }
      }
    } else if (!mutationNeeded && settled.stats.readonlyOnly) {
      const uniform = primaryToolNameIfUniform(toolCalls);
      const next = updateRepeatedReadonlyToolTurns({
        previousToolName: lastUniformToolName,
        previousCount: consecutiveSameToolTurns,
        turnToolName: uniform,
      });
      lastUniformToolName = next.toolName;
      consecutiveSameToolTurns = next.count;

      if (
        shouldNudgeDiagnoseAnswer({
          mutationRequired: false,
          consecutiveSameToolTurns,
          maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
            thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
          diagnoseAnswerNudges,
          maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
        }) &&
        budget.canStartModelCall()
      ) {
        diagnoseAnswerNudges += 1;
        reasonCodes.push("incomplete_answer_recovered");
        messages.push({
          role: "user",
          content: DIAGNOSE_ANSWER_NUDGE_MESSAGE,
        });
        warnings.push(
          `Repeated ${uniform ?? "tool"} turns without an answer; requesting a final response.`,
        );
      } else if (
        shouldLockDiagnoseAnswer({
          mutationRequired: false,
          consecutiveSameToolTurns,
          maxRepeatedReadonlyToolTurnsBeforeAnswerNudge:
            thresholds.maxRepeatedReadonlyToolTurnsBeforeAnswerNudge,
          diagnoseAnswerNudges,
          maxDiagnoseAnswerNudges: thresholds.maxDiagnoseAnswerNudges,
        })
      ) {
        awaitingAnswerOnly = true;
        reasonCodes.push("incomplete_answer_recovered");
        messages.push({
          role: "user",
          content: DIAGNOSE_ANSWER_NUDGE_MESSAGE,
        });
        warnings.push(
          "Stripped tools after repeated identical diagnostic turns; next turn must answer.",
        );
      }
    } else if (!mutationNeeded) {
      consecutiveSameToolTurns = 0;
      lastUniformToolName = undefined;
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


  return cont();
}
