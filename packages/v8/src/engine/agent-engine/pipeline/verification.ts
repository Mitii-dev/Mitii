import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import {
  buildVerificationGrant,
} from "../../../modules/decision-policy";
import type {
  ModelRequest,
} from "../../../modules/model-gateway";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { MemoryCommitInput } from "../../../modules/memory";
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
import {
  VERIFICATION_SCHEMA_VERSION,
  buildVerificationRecord,
  buildVerificationUserSummary,
} from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationResult,
} from "../../../modules/verification";

import {
  buildVerificationRepairPrompt,
  formatVerificationFailureAnswer,
  truncateForEvent,
  decideVerificationGate,
  selectUserFacingLoopAnswer,
  requiresMutationForExecute,
  shouldContinueVerificationRepair,
  nextStalledRepairCount,
  resolveVerificationProjects,
  recordBuildStateDeltaEvidence,
  recordStopEvidence,
  recordVerificationEvidence,
  markPlanEvidenceStepsDone,
  resolveLoopPolicyThresholds,
} from "../actions";
import {
  prepareRepairWorkingSet,
  completePlanStepsFromDiagnostics,
  planProgressOf,
  type TaskListRef,
} from "../internal/taskListRuntime";
import type {
  EstablishedFact,
  VerificationGateDecision,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import type {
  ToolLoopOutcome,
  VerificationGateOutcome,
} from "./types";

import { runModelToolLoop } from "./modelToolLoop";

export function isVerificationRetryAsk(message: string): boolean {
  return /\b(fix (those|them|the remaining(?: ones)?|remaining (?:errors|issues|diagnostics)|the (?:verification )?errors)|retry verification|continue (?:the )?verification)\b/i.test(
    message,
  );
}

/**
 * Shared tail for start() and resume(): interpret the model/tool loop
 * outcome, suspend for approval, gate on verification, and unpin state.
 */
export async function finishAfterLoop(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  requestId: string;
  input: AgentEngineStartInput;
  request: ModelRequest;
  decision: ExecutionDecision;
  bus: EventBus;
  signal: AbortSignal;
  pinnedState: RepositoryStateReference | undefined;
  dirtyPaths: readonly string[] | undefined;
  loopOutcome: ToolLoopOutcome;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  budget: RunBudgetTracker;
  startedAtMs: number;
  finish: (partial: {
    status: AgentRunStatus;
    route?: AgentRunResult["route"];
    planningDepth?: AgentRunResult["planningDepth"];
    answer?: string;
    suspension?: AgentRunResult["suspension"];
    pinnedState?: RepositoryStateReference;
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  cancelledResult: () => Promise<AgentRunResult>;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  repoBuildStateAfter?: RepoBuildState;
  evidence?: RunEvidence;
  onRepoBuildStateAfter?: (state: RepoBuildState) => void;
  onVerificationRecord?: (record: VerificationRecord) => void;
  windowPolicy: WindowPolicy;
  loopContext?: {
    understanding?: RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    projects?: readonly ProjectDescriptor[];
    memoryFacts?: readonly { id: string; content: string }[];
    selectedSkillIds?: string[];
    establishedFacts: EstablishedFact[];
    plan?: PlanArtifact;
  };
}): Promise<AgentRunResult> {
  const {
    runId,
    requestId,
    input,
    bus,
    signal,
    pinnedState,
    loopOutcome,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    cancelledResult,
    taskListRef,
    repoBuildStateBefore,
    evidence,
    windowPolicy,
  } = params;

  let currentOutcome = loopOutcome;
  // Authority may have been refreshed mid-loop (e.g. after approval or
  // escalation); prefer whatever the loop last resolved over the pre-loop
  // decision so verification and any repair rerun use live authority.
  let decision =
    currentOutcome.kind === "completed" ||
    currentOutcome.kind === "approval_required"
      ? currentOutcome.decision
      : params.decision;
  let afterState = params.repoBuildStateAfter;
  let repairAttempts = 0;
  let previousAfterErrorCount: number | undefined;
  let consecutiveStalledRepairs = 0;

  while (true) {
    if (currentOutcome.kind === "approval_required") {
      if (!runtime.deps.checkpointStore) {
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("misconfigured");
        return finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "misconfigured",
            message: "Approval suspend requires a checkpoint store.",
          },
        });
      }

      reasonCodes.push("approval_suspended");
      await runtime.deps.checkpointStore.save({
        runId,
        requestId,
        suspensionKind: "approval_required",
        input,
        decision,
        pinnedState,
        messages: currentOutcome.messages,
        toolCacheEntries: currentOutcome.toolCache.entries(),
        pendingApproval: currentOutcome.pendingApproval,
        changedFiles: currentOutcome.changedFiles,
        mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
        reasonCodes,
        warnings,
        usage: budget.snapshot(),
        startedAtMs,
        excludedWaitMs: budget.getExcludedWaitMs(),
        suspendedAtMs: Date.now(),
        repoBuildStateBefore,
        repoBuildStateAfter: params.repoBuildStateAfter,
        ...(taskListRef.current ? { taskList: taskListRef.current } : {}),
        ...(taskListRef.completedPlanStepIds &&
        taskListRef.completedPlanStepIds.length > 0
          ? { completedPlanStepIds: [...taskListRef.completedPlanStepIds] }
          : {}),
      });

      const rationale = `Approval required for "${currentOutcome.pendingApproval.toolName}".`;
      runtime.emit(bus, {
        type: "suspended",
        runId,
        kind: "approval_required",
        rationale,
        at: runtime.isoNow(),
      });

      // Keep the repository state pinned across suspension so resume can
      // continue against the same pinned snapshot.
      return finish({
        status: "suspended",
        route: decision.route,
        planningDepth: decision.planningDepth,
        suspension: {
          kind: "approval_required",
          rationale,
          approval: {
            approvalId: currentOutcome.pendingApproval.approvalId,
            fingerprint: currentOutcome.pendingApproval.fingerprint,
            toolName: currentOutcome.pendingApproval.toolName,
            callId: currentOutcome.pendingApproval.callId,
            paths: currentOutcome.pendingApproval.paths,
            arguments: currentOutcome.pendingApproval.arguments,
          },
        },
        reasonCodes,
      });
    }

    if (currentOutcome.kind === "cancelled") {
      await runtime.safeUnpin(runId, pinnedState);
      return await cancelledResult();
    }

    if (currentOutcome.kind === "budget_exhausted") {
      if (currentOutcome.changedFiles.length > 0) {
        const verificationOutcome = await runVerificationGate(runtime, {
          runId,
          bus,
          decision,
          primaryTaskIntent:
            params.loopContext?.understanding?.intent.classification
              .primaryTaskIntent,
          input,
          pinnedState,
          changedFiles: currentOutcome.changedFiles,
          mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
          reasonCodes,
          warnings,
          repoBuildStateBefore,
          onRepoBuildStateAfter: (state) => {
            afterState = state;
            params.onRepoBuildStateAfter?.(state);
          },
          evidence,
          windowPolicy,
        });
        commitMutations(runtime, currentOutcome.mutationCheckpointIds, {
          runId,
          bus,
          warnings,
          logVerbosity: input.logVerbosity,
        });
        const record = await persistVerificationArtifact(runtime, {
          runId,
          requestId,
          workspaceId: resolveWorkspaceId(input),
          bus,
          reasonCodes,
          warnings,
          status:
            verificationOutcome.kind === "ok" &&
            verificationOutcome.acceptKind === "verified_success"
              ? "passed"
              : "incomplete",
          before: repoBuildStateBefore,
          after: afterState,
          comparison: verificationOutcome.comparison,
          verification: verificationOutcome.verification,
          changedFiles: currentOutcome.changedFiles,
          logVerbosity: input.logVerbosity,
        });
        if (record) {
          params.onVerificationRecord?.(record);
        }
      }
      await runtime.safeUnpin(runId, pinnedState);
      reasonCodes.push("budget_exhausted");
      return finish({
        status: "budget_exhausted",
        answer: selectUserFacingLoopAnswer({
          loopAnswer: currentOutcome.answer,
          changedFiles: currentOutcome.changedFiles,
        }),
        reasonCodes,
        error: {
          code: "budget_exhausted",
          message: currentOutcome.message,
        },
      });
    }

    if (currentOutcome.kind === "failed") {
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        answer: currentOutcome.answer,
        reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
        error: currentOutcome.error,
      });
    }

    if (currentOutcome.kind !== "completed") {
      await runtime.safeUnpin(runId, pinnedState);
      return finish({
        status: "failed",
        reasonCodes: [...reasonCodes, "misconfigured"],
        error: {
          code: "misconfigured",
          message: "Verification gate expected a completed model/tool loop.",
        },
      });
    }

    const loopChangedFiles = currentOutcome.changedFiles;
    const loopMutationIds = currentOutcome.mutationCheckpointIds;
    const loopAnswer = currentOutcome.answer;

    const verificationOutcome = await runVerificationGate(runtime, {
      runId,
      bus,
      decision,
      primaryTaskIntent:
        params.loopContext?.understanding?.intent.classification
          .primaryTaskIntent,
      input,
      pinnedState,
      changedFiles: loopChangedFiles,
      mutationCheckpointIds: loopMutationIds,
      reasonCodes,
      warnings,
      repoBuildStateBefore,
      onRepoBuildStateAfter: (state) => {
        afterState = state;
        params.onRepoBuildStateAfter?.(state);
      },
      evidence,
      windowPolicy,
    });

    const recordStatus: VerificationRecordStatus =
      verificationOutcome.kind === "ok" &&
      verificationOutcome.acceptKind === "verified_success"
        ? "passed"
        : verificationOutcome.kind === "ok"
          ? "compared"
          : "incomplete";
    const record = await persistVerificationArtifact(runtime, {
      runId,
      requestId,
      workspaceId: resolveWorkspaceId(input),
      bus,
      reasonCodes,
      warnings,
      status: recordStatus,
      before: repoBuildStateBefore,
      after: afterState,
      comparison: verificationOutcome.comparison,
      verification: verificationOutcome.verification,
      changedFiles: loopChangedFiles,
      logVerbosity: input.logVerbosity,
    });
    if (record) {
      params.onVerificationRecord?.(record);
    }

    const newErrorsIntroduced =
      verificationOutcome.comparison?.reasonCodes?.includes(
        "new_errors_introduced",
      ) === true;
    const diagnosticAdvance = completePlanStepsFromDiagnostics({
      current: taskListRef.current,
      plan: params.loopContext?.plan,
      maxTasks: taskListRef.maxTasks,
      taskListRef,
      diagnostics: verificationOutcome.verification?.diagnostics,
      newErrorsIntroduced,
    });
    if (diagnosticAdvance.taskList) {
      taskListRef.current = diagnosticAdvance.taskList;
    }
    if (diagnosticAdvance.advanced) {
      reasonCodes.push("task_list_auto_advanced", "task_list_updated");
      if (diagnosticAdvance.refilled) {
        reasonCodes.push("task_list_refilled");
      }
      markPlanEvidenceStepsDone(evidence, diagnosticAdvance.completedStepIds);
      if (diagnosticAdvance.taskList) {
        runtime.emitTaskListUpdated(
          bus,
          runId,
          diagnosticAdvance.taskList,
          planProgressOf({
            plan: params.loopContext?.plan,
            completedPlanStepIds: taskListRef.completedPlanStepIds,
          }),
        );
        runtime.emitEvidenceUpdated(bus, runId, evidence);
      }
    }

    if (verificationOutcome.kind === "ok") {
      if (repairAttempts > 0) {
        reasonCodes.push("verification_repair_succeeded");
      }
      await runtime.safeUnpin(runId, pinnedState);
      reasonCodes.push("answer_produced");
      return finish({
        status: "completed",
        answer: loopAnswer,
        reasonCodes,
      });
    }

    const currentAfterErrorCount =
      verificationOutcome.comparison?.afterErrorCount ??
      verificationOutcome.verification?.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      ).length ??
      0;
    consecutiveStalledRepairs = nextStalledRepairCount({
      previousAfterErrorCount,
      currentAfterErrorCount,
      consecutiveStalledRepairs,
    });
    previousAfterErrorCount = currentAfterErrorCount;

    const repairDecision = shouldContinueVerificationRepair({
      repairAttempts,
      explorationDepth: input.explorationDepth,
      consecutiveStalledRepairs,
      canStartModelCall: budget.canStartModelCall(),
      maxAttempts: windowPolicy.run.maxVerificationRepairs,
      thresholds: resolveLoopPolicyThresholds({
        contextWindowTokens: windowPolicy.contextWindowTokens,
        overrides: input.loopPolicy?.thresholds,
      }).thresholds,
    });
    const canRepair =
      verificationOutcome.repairable &&
      repairDecision.continue &&
      currentOutcome.kind === "completed";
    if (canRepair) {
      repairAttempts += 1;
      reasonCodes.push("verification_repair_attempted");
      const repairPrep = prepareRepairWorkingSet({
        current: taskListRef.current,
        plan: params.loopContext?.plan,
        maxTasks: taskListRef.maxTasks,
        completedPlanStepIds: taskListRef.completedPlanStepIds,
      });
      if (repairPrep.refilled) {
        reasonCodes.push("task_list_refilled");
      }
      if (repairPrep.taskList) {
        taskListRef.current = repairPrep.taskList;
        if (repairPrep.refilled || repairPrep.activated) {
          reasonCodes.push("task_list_updated");
        }
        if (repairPrep.activated) {
          reasonCodes.push("verification_repair_batch_activated");
        }
        runtime.emitTaskListUpdated(
          bus,
          runId,
          repairPrep.taskList,
          planProgressOf({
            plan: params.loopContext?.plan,
            completedPlanStepIds: taskListRef.completedPlanStepIds,
          }),
        );
      }
      currentOutcome.messages.push({
        role: "user",
        content: buildVerificationRepairPrompt({
          verification: verificationOutcome.verification,
          comparison: verificationOutcome.comparison,
          changedFiles: loopChangedFiles,
          mutationBudget: decision.toolGrant.mutationBudget,
          ...(repairPrep.activeItem
            ? {
                activeBatch: {
                  title: repairPrep.activeItem.title,
                  write: repairPrep.activeItem.write,
                  mustRead: repairPrep.activeItem.mustRead,
                  affected: repairPrep.activeItem.affected,
                },
              }
            : {}),
        }),
      });
      currentOutcome = await runModelToolLoop(runtime, {
        runId,
        request: params.request,
        decision,
        understanding: params.loopContext?.understanding,
        skillsQuery: params.loopContext?.skillsQuery,
        mode: params.loopContext?.mode,
        projects: params.loopContext?.projects,
        dirtyPaths: params.dirtyPaths,
        pinnedState,
        workspaceRoot: input.workspaceRoot,
        bus,
        signal,
        budget,
        reasonCodes,
        warnings,
        messages: currentOutcome.messages,
        toolCache: currentOutcome.toolCache,
        changedFiles: loopChangedFiles,
        mutationCheckpointIds: loopMutationIds,
        taskListRef,
        memoryFacts: params.loopContext?.memoryFacts,
        establishedFacts: params.loopContext?.establishedFacts ?? [],
        selectedSkillIds: params.loopContext?.selectedSkillIds,
        evidence,
        windowPolicy,
        logVerbosity: input.logVerbosity,
        plan: params.loopContext?.plan,
        thresholds: resolveLoopPolicyThresholds({
        contextWindowTokens: windowPolicy.contextWindowTokens,
        overrides: input.loopPolicy?.thresholds,
      }).thresholds,
      });
      if (
        currentOutcome.kind === "completed" ||
        currentOutcome.kind === "approval_required"
      ) {
        decision = currentOutcome.decision;
        continue;
      }
      if (currentOutcome.kind === "cancelled") {
        await runtime.safeUnpin(runId, pinnedState);
        return await cancelledResult();
      }
      if (currentOutcome.kind === "failed") {
        await runtime.safeUnpin(runId, pinnedState);
        return finish({
          status: "failed",
          answer: currentOutcome.answer,
          reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
          error: currentOutcome.error,
        });
      }
      reasonCodes.push("budget_exhausted");
    }

    // Verification did not pass (or remaining-error repairs stalled / capped).
    // Keep the edits, summarize the delta, and end the task.
    commitMutations(runtime, loopMutationIds, {
      runId,
      bus,
      warnings,
      logVerbosity: input.logVerbosity,
    });
    reasonCodes.push(
      "verification_kept_changes",
      "verification_incomplete",
      "verification_failed",
    );
    if (
      !verificationOutcome.repairable &&
      logVerbosityAtLeast(input.logVerbosity, "standard")
    ) {
      // The run's terminal status is still "completed" here — this is the
      // only signal that changes were kept despite a hard/blocked
      // verification rejection rather than a genuinely clean pass.
      reasonCodes.push("verification_rejected_kept");
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: `Changes were kept despite a non-repairable verification rejection (${verificationOutcome.rejectKind}).`,
        code: "verification_rejected_kept",
        data: { rejectKind: verificationOutcome.rejectKind },
        at: runtime.isoNow(),
      });
    }
    const summary = await summarizeVerificationForUser(runtime, {
      bus,
      runId,
      record,
      verification: verificationOutcome.verification,
      error: verificationOutcome.error,
      before: repoBuildStateBefore,
      after: afterState,
      comparison: verificationOutcome.comparison,
      changedFiles: loopChangedFiles,
      signal,
      logVerbosity: input.logVerbosity,
    });
    reasonCodes.push("verification_summary_produced");
    const summarized =
      (await persistVerificationArtifact(runtime, {
        runId,
        requestId,
        workspaceId: resolveWorkspaceId(input),
        bus,
        reasonCodes,
        warnings,
        status: recordStatus,
        before: repoBuildStateBefore,
        after: afterState,
        comparison: verificationOutcome.comparison,
        verification: verificationOutcome.verification,
        changedFiles: loopChangedFiles,
        userSummary: summary,
        previous: record,
        logVerbosity: input.logVerbosity,
      })) ?? record;
    if (summarized) {
      params.onVerificationRecord?.(summarized);
    }
    await commitVerificationMemory(runtime, {
      record: summarized,
      summary,
      workspaceId: resolveWorkspaceId(input),
      reasonCodes,
      warnings,
    });
    if (record?.retry) {
      reasonCodes.push("verification_retry_available");
      runtime.emit(bus, {
        type: "verification_retry_available",
        runId,
        recordId: record.recordId,
        at: runtime.isoNow(),
      });
    }
    await runtime.safeUnpin(runId, pinnedState);
    reasonCodes.push("answer_produced");
    return finish({
      status: "completed",
      answer: selectUserFacingLoopAnswer({
        loopAnswer:
          "answer" in currentOutcome ? currentOutcome.answer : loopAnswer,
        fallbackSummary: summary,
        changedFiles: loopChangedFiles,
      }),
      reasonCodes,
    });
  }
}

export function captureBuildStateFromVerificationResult(
  runtime: AgentEngineRuntime,
  params: {
  input: VerificationInput;
  result: VerificationResult;
  phase: "before" | "after";
}): RepoBuildState | undefined {
  return runtime.deps.verification?.buildStateFromResult?.(
    params.input,
    params.result,
    {
      phase: params.phase,
      capturedAt: runtime.isoNow(),
    },
  );
}

export function applyRepoBuildStateComparisonReasonCodes(
  runtime: AgentEngineRuntime,
  params: {
  before?: RepoBuildState;
  after: RepoBuildState;
  reasonCodes: AgentReasonCode[];
}): RepoBuildStateComparison | undefined {
  const comparison = runtime.deps.verification?.compareBuildStates?.({
    before: params.before,
    after: params.after,
  });
  if (!comparison) {
    return undefined;
  }
  if (comparison.reasonCodes.includes("errors_cleared")) {
    params.reasonCodes.push("repo_build_state_errors_cleared");
  }
  if (comparison.reasonCodes.includes("errors_remaining")) {
    params.reasonCodes.push("repo_build_state_errors_remaining");
  }
  if (comparison.reasonCodes.includes("new_errors_introduced")) {
    params.reasonCodes.push("repo_build_state_new_errors");
  }
  return comparison;
}

/**
 * Gate completion on Verification when the decision requires it and a
 * mutation changed files. Commits on accept; leaves rollback to the caller
 * on reject (after an optional repair pass for verification_failed only).
 */
export async function runVerificationGate(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  bus: EventBus;
  decision: ExecutionDecision;
  primaryTaskIntent?: string;
  input: AgentEngineStartInput;
  pinnedState: RepositoryStateReference | undefined;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  repoBuildStateBefore?: RepoBuildState;
  onRepoBuildStateAfter?: (state: RepoBuildState) => void;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
}): Promise<VerificationGateOutcome> {
  const {
    runId,
    bus,
    decision,
    primaryTaskIntent,
    input,
    pinnedState,
    changedFiles,
    mutationCheckpointIds,
    reasonCodes,
    warnings,
    repoBuildStateBefore,
    onRepoBuildStateAfter,
    evidence,
    windowPolicy,
  } = params;

  const missingInfrastructure: string[] = [];
  if (runtime.deps.verification === undefined) {
    missingInfrastructure.push("verification port");
  }
  if (pinnedState === undefined) {
    missingInfrastructure.push("pinned state");
  }
  if (input.workspaceRoot === undefined) {
    missingInfrastructure.push("workspace root");
  }
  const canVerify = missingInfrastructure.length === 0;

  let verificationResult: VerificationResult | undefined;
  let comparison: RepoBuildStateComparison | undefined;
  const shouldRunVerificationChecks =
    changedFiles.length > 0 &&
    canVerify &&
    (decision.verification.required || Boolean(repoBuildStateBefore));
  if (shouldRunVerificationChecks) {
    runtime.emitStage(bus, runId, "verifying", "started");
    const verificationGrant = buildVerificationGrant(decision.toolGrant);
    const projects = resolveVerificationProjects(input);
    verificationResult = await runtime.deps.verification!.verify({
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      workspaceRoot: input.workspaceRoot!,
      pinnedState: pinnedState!,
      changedFiles,
      projects,
      verification: decision.verification.required
        ? decision.verification
        : {
            ...decision.verification,
            required: true,
            allowUnavailable: true,
          },
      grant: verificationGrant,
      changeScope: "localized",
      baselineDiagnostics: repoBuildStateBefore?.diagnostics,
      stateReadiness: input.repositoryState?.readiness ?? "ready",
      maxChecks: windowPolicy.maxVerificationChecks,
    });
    const afterState = captureBuildStateFromVerificationResult(runtime, {
      input: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        workspaceRoot: input.workspaceRoot!,
        pinnedState: pinnedState!,
        changedFiles,
        projects,
        verification: decision.verification,
        grant: verificationGrant,
        changeScope: "localized",
        stateReadiness: input.repositoryState?.readiness ?? "ready",
        baselineDiagnostics: repoBuildStateBefore?.diagnostics,
      },
      result: verificationResult,
      phase: "after",
    });
    if (afterState) {
      onRepoBuildStateAfter?.(afterState);
      recordBuildStateDeltaEvidence(evidence, {
        before: repoBuildStateBefore,
        after: afterState,
      });
      reasonCodes.push("repo_build_state_after_captured");
      comparison = applyRepoBuildStateComparisonReasonCodes(runtime, {
        before: repoBuildStateBefore,
        after: afterState,
        reasonCodes,
      });
    }
    recordVerificationEvidence(evidence, {
      verification: verificationResult,
      before: repoBuildStateBefore,
    });
    emitVerificationCompleted(runtime, bus, runId, verificationResult);
    runtime.emitEvidenceUpdated(bus, runId, evidence);
    if (afterState) {
      runtime.emitRepoBuildStateCaptured(bus, runId, afterState);
    }
    if (comparison) {
      runtime.emit(bus, {
        type: "verification_comparison",
        runId,
        beforeErrorCount: comparison.beforeErrorCount,
        afterErrorCount: comparison.afterErrorCount,
        clearedErrorCount: comparison.clearedErrorCount,
        newErrorCount: comparison.newErrorCount,
        remainingErrorCount: comparison.remainingErrorCount,
        newWarningCount: comparison.newWarningCount,
        clearedWarningCount: comparison.clearedWarningCount,
        failedCheckIdsAfter: comparison.failedCheckIdsAfter.slice(0, 16),
        reasonCodes: comparison.reasonCodes.slice(0, 16),
        at: runtime.isoNow(),
      });
    }
  }

  const decisionOutcome = decideVerificationGate({
      verificationRequired: decision.verification.required,
      allowUnavailable: decision.verification.allowUnavailable,
      changedFileCount: changedFiles.length,
      mutationRequired: requiresMutationForExecute({
        route: decision.route,
        maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
        primaryTaskIntent,
        reasonCodes: decision.reasonCodes,
      }),
      canVerify,
      missingInfrastructure,
      verification: verificationResult,
      comparison,
    });

  if (decisionOutcome.action === "accept") {
    applyVerificationAcceptSideEffects(runtime, {
      bus,
      runId,
      acceptKind: decisionOutcome.acceptKind,
      verification: verificationResult,
      reasonCodes,
      warnings,
    });
    commitMutations(runtime, mutationCheckpointIds, {
      runId,
      bus,
      warnings,
      logVerbosity: input.logVerbosity,
    });
    recordStopEvidence(evidence, decisionOutcome.acceptKind);
    runtime.emitEvidenceUpdated(bus, runId, evidence);
    return {
      kind: "ok",
      acceptKind: decisionOutcome.acceptKind,
      verification: verificationResult,
      comparison,
    };
  }

  runtime.emitStage(bus, runId, "verifying", "completed", [
    "verification_failed",
  ]);
  return {
    kind: "failed",
    repairable: decisionOutcome.repairable,
    rejectKind: decisionOutcome.rejectKind,
    error: decisionOutcome.error,
    verification: decisionOutcome.verification,
    comparison,
  };
}

export function applyVerificationAcceptSideEffects(
  runtime: AgentEngineRuntime,
  params: {
  bus: EventBus;
  runId: string;
  acceptKind: Extract<VerificationGateDecision, { action: "accept" }>["acceptKind"];
  verification: VerificationResult | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): void {
  const { bus, runId, acceptKind, verification, reasonCodes, warnings } =
    params;

  if (acceptKind === "skipped_not_required") {
    return;
  }

  if (acceptKind === "verified_success") {
    runtime.emitStage(bus, runId, "verifying", "completed", [
      "verification_passed",
    ]);
    reasonCodes.push("verification_passed");
    return;
  }

  // implemented_unverified | unavailable_allowed
  runtime.emitStage(bus, runId, "verifying", "completed", [
    "verification_skipped",
  ]);
  reasonCodes.push("verification_skipped");
  if (acceptKind === "implemented_unverified" && verification) {
    warnings.push(
      `Verification incomplete (status: ${verification.status}); implementation kept unverified.`,
    );
  } else if (acceptKind === "unavailable_allowed") {
    warnings.push(
      "Verification was required but unavailable; implementation kept unverified.",
    );
  }
}

export function commitMutations(
  runtime: AgentEngineRuntime,
  
  mutationCheckpointIds: readonly string[],
  context?: {
    runId: string;
    bus: EventBus;
    warnings: string[];
    logVerbosity: AgentLogVerbosity;
  },
): void {
  if (mutationCheckpointIds.length === 0 || !runtime.deps.tools?.commitMutation) {
    return;
  }
  for (const checkpointId of mutationCheckpointIds) {
    try {
      runtime.deps.tools.commitMutation(checkpointId);
    } catch (error) {
      // Best-effort: the mutation already applied to the workspace: a
      // failed checkpoint commit does not undo the edit, it only means the
      // checkpoint bookkeeping for that file may be stale.
      const message = `Failed to commit mutation checkpoint "${checkpointId}": ${describeCaughtError(error)}`;
      context?.warnings.push(message);
      if (context && logVerbosityAtLeast(context.logVerbosity, "standard")) {
        runtime.emit(context.bus, {
          type: "warning",
          runId: context.runId,
          message,
          code: "mutation_commit_failed",
          data: { checkpointId },
          at: runtime.isoNow(),
        });
      }
    }
  }
}

export function emitVerificationCompleted(
  runtime: AgentEngineRuntime,
  
  bus: EventBus,
  runId: string,
  verification: VerificationResult,
): void {
  runtime.emit(bus, {
    type: "verification_completed",
    runId,
    status: verification.status,
    reasonCodes: verification.reasonCodes,
    checks: verification.checks.slice(0, 20).map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      outcome: check.outcome,
      summary: truncateForEvent(check.summary, 500),
    })),
    diagnostics: verification.diagnostics.slice(0, 20).map((diag) => ({
      path: truncateForEvent(diag.path, 512),
      severity: diag.severity,
      message: truncateForEvent(diag.message, 500),
      startLine: diag.startLine,
      source: diag.source
        ? truncateForEvent(diag.source, 120)
        : undefined,
      code: diag.code ? truncateForEvent(diag.code, 120) : undefined,
    })),
    warnings: verification.warnings
      .slice(0, 20)
      .map((warning) => truncateForEvent(warning, 500)),
    truncated:
      verification.checks.length > 20 || verification.diagnostics.length > 20
        ? true
        : undefined,
    at: runtime.isoNow(),
  });
}

export async function persistVerificationArtifact(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  requestId: string;
  workspaceId?: string;
  bus: EventBus;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  status: VerificationRecordStatus;
  before?: RepoBuildState;
  after?: RepoBuildState;
  comparison?: RepoBuildStateComparison;
  verification?: VerificationResult;
  changedFiles?: readonly string[];
  userSummary?: string;
  previous?: VerificationRecord;
  logVerbosity: AgentLogVerbosity;
}): Promise<VerificationRecord | undefined> {
  if (!params.before && !params.after && !params.verification) {
    return params.previous;
  }
  let record: VerificationRecord;
  try {
    record = buildVerificationRecord({
      runId: params.runId,
      requestId: params.requestId,
      workspaceId: params.workspaceId,
      recordId: params.previous?.recordId ?? params.runId,
      capturedAt: params.previous?.capturedAt,
      status: params.status,
      before: params.before ?? params.previous?.before,
      after: params.after ?? params.previous?.after,
      comparison: params.comparison ?? params.previous?.comparison,
      verification: params.verification ?? params.previous?.verification,
      changedFiles: params.changedFiles ?? params.previous?.changedFiles,
      userSummary: params.userSummary ?? params.previous?.userSummary,
    });
  } catch (error) {
    const message = `Verification record could not be built: ${describeCaughtError(error)}`;
    params.warnings.push(message);
    params.reasonCodes.push("verification_record_build_failed");
    if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message,
        code: "verification_record_build_failed",
        at: runtime.isoNow(),
      });
    }
    return params.previous;
  }

  if (runtime.deps.verification?.persistRecord) {
    try {
      await runtime.deps.verification.persistRecord(record);
      params.reasonCodes.push("verification_record_saved");
      runtime.emit(params.bus, {
        type: "verification_record_saved",
        runId: params.runId,
        recordId: record.recordId,
        status: record.status,
        retryAvailable: Boolean(record.retry),
        at: runtime.isoNow(),
      });
    } catch (error) {
      params.warnings.push(
        `Verification record persist failed: ${describeCaughtError(error)}`,
      );
    }
  }

  return record;
}

export async function summarizeVerificationForUser(
  runtime: AgentEngineRuntime,
  params: {
  bus: EventBus;
  runId: string;
  record?: VerificationRecord;
  verification?: VerificationResult;
  error: { code: string; message: string };
  before?: RepoBuildState;
  after?: RepoBuildState;
  comparison?: RepoBuildStateComparison;
  changedFiles: readonly string[];
  signal: AbortSignal;
  logVerbosity: AgentLogVerbosity;
}): Promise<string> {
  const fallback = params.record
    ? buildVerificationUserSummary(params.record)
    : formatVerificationFailureAnswer({
        error: params.error,
        verification: params.verification,
        changedFiles: params.changedFiles,
        rolledBack: false,
      });
  const narration = await tryNarrateVerificationSummary(runtime, {
    record: params.record,
    fallback,
    signal: params.signal,
  });
  if (
    narration.skippedReason &&
    logVerbosityAtLeast(params.logVerbosity, "verbose")
  ) {
    // Not a run failure — the deterministic fallback summary is always
    // correct — but without this, "narration ran and was rejected" and
    // "narration wasn't attempted" are indistinguishable in logs.
    runtime.emit(params.bus, {
      type: "warning",
      runId: params.runId,
      message: `LLM verification-summary narration was skipped (${narration.skippedReason}); used the deterministic summary instead.`,
      code: "verification_narration_failed",
      data: { skippedReason: narration.skippedReason },
      at: runtime.isoNow(),
    });
  }
  const summary = narration.text ?? fallback;
  runtime.emit(params.bus, {
    type: "verification_summary_ready",
    runId: params.runId,
    summaryChars: summary.length,
    newErrorCount: params.comparison?.newErrorCount ??
      params.record?.comparison?.newErrorCount,
    remainingErrorCount:
      params.comparison?.remainingErrorCount ??
      params.record?.comparison?.remainingErrorCount,
    clearedErrorCount:
      params.comparison?.clearedErrorCount ??
      params.record?.comparison?.clearedErrorCount,
    at: runtime.isoNow(),
  });
  return summary;
}

export async function tryNarrateVerificationSummary(
  runtime: AgentEngineRuntime,
  params: {
  record?: VerificationRecord;
  fallback: string;
  signal: AbortSignal;
}): Promise<
  | { text: string; skippedReason?: undefined }
  | { text?: undefined; skippedReason?: string }
> {
  if (!params.record || params.signal.aborted) {
    return { skippedReason: undefined };
  }
  try {
    const request: ModelRequest = {
      messages: [
        {
          role: "system",
          content:
            "Write a short user-facing summary of a verification delta. Do not invent errors. Do not call tools. Keep the numeric counts from the evidence. Four to eight sentences.",
        },
        {
          role: "user",
          content: params.fallback,
        },
      ],
    };
    let text = "";
    let sawToolCall = false;
    for await (const event of runtime.deps.llm.complete(request, {
      abortSignal: params.signal,
    })) {
      if (event.type === "content_delta" && event.content) {
        text += event.content;
      }
      if (event.type === "tool_call_delta") {
        sawToolCall = true;
      }
      if (event.type === "failed" || event.type === "cancelled") {
        return { skippedReason: `llm_${event.type}` };
      }
    }
    const trimmed = text.trim();
    if (
      sawToolCall ||
      trimmed.length < 20 ||
      !/\b(error|verification|cleared|remaining|kept the edits)\b/i.test(
        trimmed,
      )
    ) {
      return { skippedReason: "rejected_quality_gate" };
    }
    return { text: trimmed.slice(0, 4_000) };
  } catch (error) {
    return { skippedReason: `llm_error:${describeCaughtError(error)}` };
  }
}

export async function commitVerificationMemory(
  runtime: AgentEngineRuntime,
  params: {
  record?: VerificationRecord;
  summary: string;
  workspaceId?: string;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): Promise<void> {
  if (!runtime.deps.memory?.commit || !params.workspaceId || !params.record) {
    return;
  }
  const input: MemoryCommitInput = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    content: [
      `Verification leftover from run ${params.record.runId}.`,
      params.summary.slice(0, 1_200),
      `Retry handle: verification/${params.record.recordId}.`,
      `Say "fix the remaining verification errors" to continue.`,
    ].join(" "),
    scope: { kind: "workspace", workspaceId: params.workspaceId },
    tags: ["verification", "retry"],
    privacy: "private",
    source: "verification",
    type: "bug",
  };
  try {
    const result = await runtime.deps.memory.commit(input);
    if (result.status === "committed") {
      params.reasonCodes.push("memory_committed");
    }
  } catch (error) {
    params.warnings.push(
      `Verification memory commit failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function tryLoadVerificationRetry(
  runtime: AgentEngineRuntime,
  params: {
  workspaceId?: string;
  userMessage: string;
  runId: string;
  bus: EventBus;
  warnings: string[];
  logVerbosity: AgentLogVerbosity;
}): Promise<VerificationRecord | undefined> {
  if (
    !params.workspaceId ||
    !runtime.deps.verification?.loadLatestRecord ||
    !isVerificationRetryAsk(params.userMessage)
  ) {
    return undefined;
  }
  try {
    return await runtime.deps.verification.loadLatestRecord(params.workspaceId);
  } catch (error) {
    // Distinct from "no prior record" (a resolved undefined): the store
    // read itself failed, so the user's retry ask silently gets no record.
    const message = `Failed to load the prior verification record: ${describeCaughtError(error)}`;
    params.warnings.push(message);
    if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message,
        code: "verification_retry_load_failed",
        at: runtime.isoNow(),
      });
    }
    return undefined;
  }
}
