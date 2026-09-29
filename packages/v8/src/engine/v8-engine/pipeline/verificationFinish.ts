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
  isPrematurePartialExecuteStop,
  isSyntheticCompletedEditsFallback,
  requiresMutationForExecute,
  selectUserFacingLoopAnswer,
  markPlanEvidenceStepsDone,
  resolveLoopPolicyThresholds,
} from "../actions";
import {
  completePlanStepsFromDiagnostics,
  hasIncompleteChangeSurfaces,
  markTaskListUpdated,
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

import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import type {
  ToolLoopOutcome,
} from "./types";

import {
  commitMutations,
  persistVerificationArtifact,
  runVerificationGate,
} from "./verificationSupport";

import {
  suspendForBudgetWall,
  type SuspendBudgetWallContext,
} from "./verificationBudgetWall";
import { finishIfApprovalRequired } from "./verificationFinishApproval";
import {
  finishIfGrantExpansionRequired,
  finishIfContinueRequired,
} from "./verificationFinishSuspend";
import { handleVerificationFailed } from "./verificationFinishFailed";

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
  /** Seeded after a Continue resume so nested walls honor the override cap. */
  continueOverrideCount?: number;
  loopContext?: {
    understanding?: RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    projects?: readonly ProjectDescriptor[];
    memoryFacts?: readonly { id: string; content: string }[];
    selectedSkillIds?: string[];
    projectRuleIds?: string[];
    environmentIds?: string[];
    requiredSkillIds?: string[];
    excludedSkillIds?: string[];
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
  const continueOverrideCount = params.continueOverrideCount ?? 0;
  const thresholds = resolveLoopPolicyThresholds({
    contextWindowTokens: windowPolicy.contextWindowTokens,
    overrides: input.loopPolicy?.thresholds,
  }).thresholds;

  const budgetWallCtxBase = (): Omit<SuspendBudgetWallContext, "decision" | "afterState"> => ({
    runtime,
    runId,
    requestId,
    input,
    bus,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    repoBuildStateAfter: params.repoBuildStateAfter,
    continueOverrideCount,
    maxContinueOverrides: thresholds.maxContinueOverrides,
    plan: params.loopContext?.plan,
  });
  const suspendForBudgetWallLocal = async (
    opts: Parameters<typeof suspendForBudgetWall>[1],
    decision: ExecutionDecision,
    afterState?: RepoBuildState,
  ) =>
    suspendForBudgetWall(
      { ...budgetWallCtxBase(), decision, afterState },
      opts,
    );

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
      return await finishIfApprovalRequired(runtime, {
        runId,
        requestId,
        input,
        decision,
        bus,
        pinnedState,
        currentOutcome,
        reasonCodes,
        warnings,
        budget,
        startedAtMs,
        finish,
        taskListRef,
        repoBuildStateBefore,
        repoBuildStateAfter: params.repoBuildStateAfter,
      });
    }

    if (currentOutcome.kind === "grant_expansion_required") {
      return await finishIfGrantExpansionRequired(runtime, {
        runId,
        requestId,
        input,
        decision,
        bus,
        pinnedState,
        currentOutcome,
        reasonCodes,
        warnings,
        budget,
        startedAtMs,
        finish,
        taskListRef,
        repoBuildStateBefore,
        repoBuildStateAfter: params.repoBuildStateAfter,
        plan: params.loopContext?.plan,
      });
    }

    if (currentOutcome.kind === "continue_required") {
      return await finishIfContinueRequired(runtime, {
        runId,
        requestId,
        input,
        decision,
        bus,
        pinnedState,
        currentOutcome,
        reasonCodes,
        warnings,
        budget,
        startedAtMs,
        finish,
        taskListRef,
        repoBuildStateBefore,
        repoBuildStateAfter: params.repoBuildStateAfter,
        afterState,
        plan: params.loopContext?.plan,
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
      markTaskListUpdated(taskListRef, budget.snapshot().modelCalls);
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
      const userAnswer = selectUserFacingLoopAnswer({
        loopAnswer,
        changedFiles: loopChangedFiles,
      });
      const answerForIncompleteCheck = userAnswer ?? loopAnswer ?? "";
      const incompleteExecute =
        requiresMutationForExecute({
          route: decision.route,
          maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
          primaryTaskIntent:
            params.loopContext?.understanding?.intent.classification
              .primaryTaskIntent,
          reasonCodes: decision.reasonCodes,
          allowedTools: decision.toolGrant.allowedTools,
        }) &&
        hasIncompleteChangeSurfaces(taskListRef.current) &&
        // Partial progress with an honest next-step answer may leave rows open.
        // Fail when: no edits, blocker stop, empty/synthetic fallback, or
        // mid-work stop that never acknowledged remaining checklist work
        // (BillBuddy 00:13 completed after one SharedBasePage batch).
        // Evaluate the user-facing answer (not raw loop text) so thin
        // synthetic fallbacks still trip incomplete_execute.
        (loopChangedFiles.length === 0 ||
          isPrematurePartialExecuteStop({
            mutationRequired: true,
            hasIncompleteChangeSurfaces: true,
            content: answerForIncompleteCheck,
            changedFileCount: loopChangedFiles.length,
          }) ||
          isSyntheticCompletedEditsFallback(answerForIncompleteCheck) ||
          /(?:^|\n)\s*(?:\*{0,2}|_{0,2})?\s*blocker(?:\*{0,2}|_{0,2})?\s*[:\-—]/im.test(
            answerForIncompleteCheck,
          ) ||
          /\b(?:stop(?:ping)?\s+here\s+with\s+a\s+clear\s+blocker|have\s+to\s+stop\s+here\s+with\s+a\s+clear\s+blocker)\b/i.test(
            answerForIncompleteCheck,
          ));
      if (incompleteExecute && currentOutcome.kind === "completed") {
        const suspended = await suspendForBudgetWallLocal({
          wallReason: "incomplete_checklist",
          messages: currentOutcome.messages,
          toolCache: currentOutcome.toolCache,
          changedFiles: loopChangedFiles,
          mutationCheckpointIds: loopMutationIds,
          answer: userAnswer ?? "",
          mutationRequired: true,
        }, decision, afterState);
        if (suspended) {
          return suspended;
        }
        reasonCodes.push("stall_continue_override_capped");
      }
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

    {
      const handled = await handleVerificationFailed({
        runtime,
        runId,
        requestId,
        input,
        request: params.request,
        bus,
        signal,
        pinnedState,
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
        loopContext: params.loopContext,
        verificationOutcome,
        record,
        recordStatus,
        loopChangedFiles,
        loopMutationIds,
        loopAnswer,
        thresholds,
        continueOverrideCount,
        dirtyPaths: params.dirtyPaths,
        onVerificationRecord: params.onVerificationRecord,
        state: {
          currentOutcome,
          decision,
          afterState,
          repairAttempts,
          previousAfterErrorCount,
          consecutiveStalledRepairs,
        },
      });
      if (handled.kind === "return") {
        return handled.result;
      }
      currentOutcome = handled.state.currentOutcome;
      decision = handled.state.decision;
      afterState = handled.state.afterState;
      repairAttempts = handled.state.repairAttempts;
      previousAfterErrorCount = handled.state.previousAfterErrorCount;
      consecutiveStalledRepairs = handled.state.consecutiveStalledRepairs;
      continue;
    }

  }
}
