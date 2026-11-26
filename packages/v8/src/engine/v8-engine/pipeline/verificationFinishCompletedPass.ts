/**
 * Completed-loop verification: gate, persist artifact, diagnostic task-list advance.
 */
import type {
  VerificationRecord,
  VerificationRecordStatus,
} from "../../../modules/verification";

import { markPlanEvidenceStepsDone } from "../actions";
import {
  completePlanStepsFromDiagnostics,
  markTaskListUpdated,
  planProgressOf,
} from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import {
  persistVerificationArtifact,
  runVerificationGate,
} from "./verificationSupport";
import type { VerificationGateOutcome } from "./types";
import type {
  FinishAfterLoopParams,
  FinishLoopMutable,
} from "./verificationFinishTypes";

export type CompletedVerificationPass = {
  verificationOutcome: VerificationGateOutcome;
  record: VerificationRecord | undefined;
  recordStatus: VerificationRecordStatus;
  loopChangedFiles: string[];
  loopMutationIds: string[];
  loopAnswer: string | undefined;
};

export async function runCompletedVerificationPass(
  runtime: AgentEngineRuntime,
  params: FinishAfterLoopParams,
  state: FinishLoopMutable,
): Promise<CompletedVerificationPass> {
  const {
    runId,
    requestId,
    input,
    bus,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    taskListRef,
    repoBuildStateBefore,
    evidence,
    windowPolicy,
  } = params;

  const currentOutcome = state.currentOutcome;
  if (currentOutcome.kind !== "completed") {
    throw new Error("runCompletedVerificationPass requires completed outcome");
  }

  const loopChangedFiles = currentOutcome.changedFiles;
  const loopMutationIds = currentOutcome.mutationCheckpointIds;
  const loopAnswer = currentOutcome.answer;

  const verificationOutcome = await runVerificationGate(runtime, {
    runId,
    bus,
    decision: state.decision,
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
    onRepoBuildStateAfter: (next) => {
      state.afterState = next;
      params.onRepoBuildStateAfter?.(next);
    },
    evidence,
    windowPolicy,
    signal: params.signal,
    askScopePaths: [
      ...(params.loopContext?.executionSeed?.paths ?? []),
      ...(params.loopContext?.memoryFileTargets ?? []),
    ],
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
    after: state.afterState,
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

  return {
    verificationOutcome,
    record,
    recordStatus,
    loopChangedFiles,
    loopMutationIds,
    loopAnswer,
  };
}
