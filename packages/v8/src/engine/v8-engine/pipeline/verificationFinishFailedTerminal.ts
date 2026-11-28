/**
 * Keep mutations and terminal-finish after verification failed / repair exhausted.
 */
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type {
  RepoBuildState,
  VerificationRecord,
  VerificationRecordStatus,
} from "../../../modules/verification";

import {
  resolveFailedVerificationTerminalStatus,
  selectUserFacingLoopAnswer,
  shouldSuspendContinueAfterRepairExhausted,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import type { VerificationGateOutcome } from "./types";
import {
  commitMutations,
  commitVerificationMemory,
  persistVerificationArtifact,
  summarizeVerificationForUser,
} from "./verificationSupport";
import {
  suspendForBudgetWall,
  type SuspendBudgetWallContext,
} from "./verificationBudgetWall";
import type { VerificationRepairState } from "./verificationFinishFailedTypes";
import type { FinishAfterLoopFinish } from "./verificationFinishTypes";

type FailedGate = Extract<VerificationGateOutcome, { kind: "failed" }>;

export async function finishFailedVerificationTerminal(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  pinnedState: RepositoryStateReference | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  finish: FinishAfterLoopFinish;
  verificationOutcome: FailedGate;
  record: VerificationRecord | undefined;
  recordStatus: VerificationRecordStatus;
  loopChangedFiles: string[];
  loopMutationIds: string[];
  loopAnswer: string | undefined;
  repoBuildStateBefore?: RepoBuildState;
  onVerificationRecord?: (record: VerificationRecord) => void;
  budgetWallCtx: () => SuspendBudgetWallContext;
  state: VerificationRepairState;
}): Promise<{ kind: "return"; result: AgentRunResult }> {
  const {
    runtime,
    runId,
    requestId,
    input,
    bus,
    signal,
    pinnedState,
    reasonCodes,
    warnings,
    finish,
    verificationOutcome,
    record,
    recordStatus,
    loopChangedFiles,
    loopMutationIds,
    loopAnswer,
    repoBuildStateBefore,
    budgetWallCtx,
    state,
  } = params;
  const { currentOutcome, afterState } = state;

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
  // Finalize verification evidence and memory. Repair exhaustion is a hard
  // STOP/REPORT — never offer verification_repair_capped Continue.
  if (
    verificationOutcome.repairable &&
    currentOutcome.kind === "completed" &&
    loopChangedFiles.length > 0
  ) {
    if (shouldSuspendContinueAfterRepairExhausted()) {
      const suspended = await suspendForBudgetWall(budgetWallCtx(), {
        wallReason: "verification_repair_capped",
        messages: currentOutcome.messages,
        toolCache: currentOutcome.toolCache,
        changedFiles: loopChangedFiles,
        mutationCheckpointIds: loopMutationIds,
        answer:
          selectUserFacingLoopAnswer({
            loopAnswer: currentOutcome.answer,
            fallbackSummary: summary,
            changedFiles: loopChangedFiles,
          }) ?? summary,
        mutationRequired: true,
      });
      if (suspended) {
        return { kind: "return", result: suspended };
      }
      reasonCodes.push("stall_continue_override_capped");
    } else {
      reasonCodes.push("verification_repair_exhausted_terminal");
    }
  }
  await runtime.safeUnpin(runId, pinnedState);
  reasonCodes.push("answer_produced");
  const status = resolveFailedVerificationTerminalStatus({
    changedFileCount: loopChangedFiles.length,
    rejectKind: verificationOutcome.rejectKind,
  });
  if (
    status === "failed" &&
    verificationOutcome.rejectKind === "no_mutation_performed"
  ) {
    reasonCodes.push("no_mutation_performed", "incomplete_execute");
  }
  return {
    kind: "return",
    result: finish({
      status,
      answer: selectUserFacingLoopAnswer({
        loopAnswer:
          "answer" in currentOutcome ? currentOutcome.answer : loopAnswer,
        fallbackSummary: summary,
        changedFiles: loopChangedFiles,
      }),
      reasonCodes,
      error: status === "failed" ? verificationOutcome.error : undefined,
    }),
  };
}
