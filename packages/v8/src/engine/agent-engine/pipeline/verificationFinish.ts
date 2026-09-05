import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import type {
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
  VerificationRecord,
  VerificationRecordStatus,
} from "../../../modules/verification";

import {
  buildVerificationRepairPrompt,
  requiresMutationForExecute,
  selectUserFacingLoopAnswer,
  shouldContinueVerificationRepair,
  nextStalledRepairCount,
  markPlanEvidenceStepsDone,
  resolveLoopPolicyThresholds,
} from "../actions";
import {
  prepareRepairWorkingSet,
  completePlanStepsFromDiagnostics,
  hasIncompleteChangeSurfaces,
  planProgressOf,
  type TaskListRef,
} from "../internal/taskListRuntime";
import type {
  EstablishedFact,
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
} from "../internal/logVerbosity";

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import type {
  ToolLoopOutcome,
} from "./types";

import { runModelToolLoop } from "./modelToolLoop";
import {
  commitMutations,
  commitVerificationMemory,
  persistVerificationArtifact,
  runVerificationGate,
  summarizeVerificationForUser,
} from "./verificationSupport";

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
    requiredSkillIds?: string[];
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
    currentOutcome.kind === "approval_required" ||
    currentOutcome.kind === "grant_expansion_required" ||
    currentOutcome.kind === "continue_required"
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

    if (currentOutcome.kind === "grant_expansion_required") {
      if (!runtime.deps.checkpointStore) {
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("misconfigured");
        return finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "misconfigured",
            message: "Grant expansion suspend requires a checkpoint store.",
          },
        });
      }

      const expansionId = runtime.deps.idGenerator.next("gexp");
      reasonCodes.push("grant_expansion_suspended");
      await runtime.deps.checkpointStore.save({
        runId,
        requestId,
        suspensionKind: "grant_expansion_required",
        input,
        decision,
        pinnedState,
        messages: currentOutcome.messages,
        toolCacheEntries: currentOutcome.toolCache.entries(),
        pendingGrantExpansion: {
          expansionId,
          extraPaths: [...currentOutcome.extraPaths],
        },
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
        ...(params.loopContext?.plan ? { plan: params.loopContext.plan } : {}),
      });

      const pathPreview = currentOutcome.extraPaths.slice(0, 5).join(", ");
      const more =
        currentOutcome.extraPaths.length > 5
          ? ` (+${currentOutcome.extraPaths.length - 5} more)`
          : "";
      const rationale = `Workspace access expansion required for: ${pathPreview}${more}.`;
      runtime.emit(bus, {
        type: "suspended",
        runId,
        kind: "grant_expansion_required",
        rationale,
        at: runtime.isoNow(),
      });

      return finish({
        status: "suspended",
        route: decision.route,
        planningDepth: decision.planningDepth,
        suspension: {
          kind: "grant_expansion_required",
          rationale,
          grantExpansion: {
            expansionId,
            extraPaths: currentOutcome.extraPaths.slice(0, 50),
            currentPathScopes: decision.toolGrant.pathScopes.slice(0, 20),
          },
        },
        reasonCodes,
      });
    }

    if (currentOutcome.kind === "continue_required") {
      if (!runtime.deps.checkpointStore) {
        await runtime.safeUnpin(runId, pinnedState);
        reasonCodes.push("misconfigured");
        return finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "misconfigured",
            message: "Continue suspend requires a checkpoint store.",
          },
        });
      }

      reasonCodes.push("stall_continue_suspended");
      await runtime.deps.checkpointStore.save({
        runId,
        requestId,
        suspensionKind: "continue_required",
        input,
        decision,
        pinnedState,
        messages: currentOutcome.messages,
        toolCacheEntries: currentOutcome.toolCache.entries(),
        changedFiles: currentOutcome.changedFiles,
        mutationCheckpointIds: currentOutcome.mutationCheckpointIds,
        stallContinueRationale: currentOutcome.rationale,
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
        ...(params.loopContext?.plan ? { plan: params.loopContext.plan } : {}),
      });

      runtime.emit(bus, {
        type: "suspended",
        runId,
        kind: "continue_required",
        rationale: currentOutcome.rationale,
        at: runtime.isoNow(),
      });

      return finish({
        status: "suspended",
        route: decision.route,
        planningDepth: decision.planningDepth,
        answer: currentOutcome.answer || undefined,
        suspension: {
          kind: "continue_required",
          rationale: currentOutcome.rationale,
          continuePrompt: currentOutcome.rationale,
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
      const incompleteExecute =
        requiresMutationForExecute({
          route: decision.route,
          maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
          primaryTaskIntent:
            params.loopContext?.understanding?.intent.classification
              .primaryTaskIntent,
          reasonCodes: decision.reasonCodes,
        }) &&
        hasIncompleteChangeSurfaces(taskListRef.current) &&
        // Partial progress with an honest next-step answer may leave rows open.
        // Fail only when the run stopped with no edits or a stuck blocker answer.
        (loopChangedFiles.length === 0 ||
          /(?:^|\n)\s*(?:\*{0,2}|_{0,2})?\s*blocker(?:\*{0,2}|_{0,2})?\s*[:\-—]/im.test(
            loopAnswer ?? "",
          ) ||
          /\b(?:stop(?:ping)?\s+here\s+with\s+a\s+clear\s+blocker|have\s+to\s+stop\s+here\s+with\s+a\s+clear\s+blocker)\b/i.test(
            loopAnswer ?? "",
          ));
      const userAnswer = selectUserFacingLoopAnswer({
        loopAnswer,
        changedFiles: loopChangedFiles,
      });
      await runtime.safeUnpin(runId, pinnedState);
      if (incompleteExecute) {
        reasonCodes.push("incomplete_execute", "answer_produced");
        return finish({
          status: "failed",
          answer: userAnswer,
          reasonCodes,
          error: {
            code: "incomplete_execute",
            message:
              "The execute run ended while change checklist surfaces were still open.",
          },
        });
      }
      reasonCodes.push("answer_produced");
      return finish({
        status: "completed",
        answer: userAnswer,
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
        requiredSkillIds: params.loopContext?.requiredSkillIds,
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
    const keptMutationsWithFailedVerification = loopChangedFiles.length > 0;
    return finish({
      status: keptMutationsWithFailedVerification ? "failed" : "completed",
      answer: selectUserFacingLoopAnswer({
        loopAnswer:
          "answer" in currentOutcome ? currentOutcome.answer : loopAnswer,
        fallbackSummary: summary,
        changedFiles: loopChangedFiles,
      }),
      reasonCodes,
      error: keptMutationsWithFailedVerification
        ? verificationOutcome.error
        : undefined,
    });
  }
}
