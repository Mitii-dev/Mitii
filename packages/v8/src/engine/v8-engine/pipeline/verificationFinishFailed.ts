import type { ExecutionDecision } from "../../../modules/decision-policy";
import type { ModelRequest } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RepoBuildState,
  VerificationRecord,
  VerificationRecordStatus,
} from "../../../modules/verification";

import {
  buildVerificationRepairPrompt,
  loadDiagnosticSourceLines,
  resolveFailedVerificationTerminalStatus,
  selectUserFacingLoopAnswer,
  shouldContinueVerificationRepair,
  nextStalledRepairCount,
  resolveLoopPolicyThresholds,
} from "../actions";
import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import {
  prepareRepairWorkingSet,
  planProgressOf,
  type TaskListRef,
} from "../internal/taskListRuntime";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import { RunBudgetTracker } from "../internal/RunBudget";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import type { ToolLoopOutcome, VerificationGateOutcome } from "./types";
import { runV8ModelLoop } from "./modelLoop";
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

export type VerificationRepairState = {
  currentOutcome: ToolLoopOutcome;
  decision: ExecutionDecision;
  afterState?: RepoBuildState;
  repairAttempts: number;
  previousAfterErrorCount?: number;
  consecutiveStalledRepairs: number;
};

type FailedGate = Extract<VerificationGateOutcome, { kind: "failed" }>;

export async function handleVerificationFailed(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  requestId: string;
  input: AgentEngineStartInput;
  request: ModelRequest;
  bus: EventBus;
  signal: AbortSignal;
  pinnedState: RepositoryStateReference | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  budget: RunBudgetTracker;
  startedAtMs: number;
  finish: SuspendBudgetWallContext["finish"];
  cancelledResult: () => Promise<AgentRunResult>;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
  loopContext?: {
    understanding?: import("../../../modules/request-understanding").RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    projects?: readonly import("../../../modules/repository-state").ProjectDescriptor[];
    memoryFacts?: readonly { id: string; content: string }[];
    memoryQuery?: string;
    memoryWorkspaceId?: string;
    memoryFileTargets?: readonly string[];
    establishedFacts?: import("../actions").EstablishedFact[];
    selectedSkillIds?: string[];
    projectRuleIds?: string[];
    environmentIds?: string[];
    instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
    requiredSkillIds?: string[];
    excludedSkillIds?: string[];
    plan?: import("../../../modules/planning").PlanArtifact;
    executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  };
  verificationOutcome: FailedGate;
  record: VerificationRecord | undefined;
  recordStatus: VerificationRecordStatus;
  loopChangedFiles: string[];
  loopMutationIds: string[];
  loopAnswer: string | undefined;
  thresholds: ReturnType<typeof resolveLoopPolicyThresholds>["thresholds"];
  continueOverrideCount: number;
  dirtyPaths: readonly string[] | undefined;
  onVerificationRecord?: (record: VerificationRecord) => void;
  state: VerificationRepairState;
}): Promise<
  | { kind: "return"; result: AgentRunResult }
  | { kind: "continue"; state: VerificationRepairState }
> {
  const {
    runtime,
    runId,
    requestId,
    input,
    request,
    bus,
    signal,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    finish,
    cancelledResult,
    taskListRef,
    repoBuildStateBefore,
    evidence,
    windowPolicy,
    loopContext,
    verificationOutcome,
    record,
    recordStatus,
    loopChangedFiles,
    loopMutationIds,
    loopAnswer,
    thresholds,
    continueOverrideCount,
    dirtyPaths,
  } = params;

  let {
    currentOutcome,
    decision,
    afterState,
    repairAttempts,
    previousAfterErrorCount,
    consecutiveStalledRepairs,
  } = params.state;

  const budgetWallCtx = (): SuspendBudgetWallContext => ({
    runtime,
    runId,
    requestId,
    input,
    decision,
    bus,
    pinnedState,
    reasonCodes,
    warnings,
    budget,
    startedAtMs: params.startedAtMs,
    finish,
    taskListRef,
    repoBuildStateBefore,
    afterState,
    repoBuildStateAfter: afterState,
    continueOverrideCount,
    maxContinueOverrides: thresholds.maxContinueOverrides,
    plan: loopContext?.plan,
  });

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
    thresholds,
  });
  const canRepair =
    verificationOutcome.repairable &&
    repairDecision.continue &&
    currentOutcome.kind === "completed";
  if (canRepair && currentOutcome.kind === "completed") {
    repairAttempts += 1;
    reasonCodes.push("verification_repair_attempted");
    const repairPrep = prepareRepairWorkingSet({
      current: taskListRef.current,
      plan: loopContext?.plan,
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
          plan: loopContext?.plan,
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
        sourceLines: await loadRepairSourceLines({
          workspaceRoot: input.workspaceRoot,
          verification: verificationOutcome.verification,
        }),
        askScopePaths: [
          ...(loopContext?.executionSeed?.paths ?? []),
          ...(loopContext?.memoryFileTargets ?? []),
          ...loopChangedFiles,
        ],
        userPrompt: loopContext?.skillsQuery ?? loopContext?.memoryQuery ?? "",
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
    currentOutcome = await runV8ModelLoop(runtime, {
      runId,
      requestId,
      interactionMode: loopContext?.mode ?? input.request.mode,
      llm: runtime.deps.llm,
      request,
      decision,
      understanding: loopContext?.understanding,
      dirtyPaths,
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
      memoryFacts: loopContext?.memoryFacts,
      memoryQuery: loopContext?.memoryQuery,
      memoryWorkspaceId: loopContext?.memoryWorkspaceId,
      memoryFileTargets: loopContext?.memoryFileTargets,
      establishedFacts: loopContext?.establishedFacts ?? [],
      selectedSkillIds: loopContext?.selectedSkillIds,
      projectRuleIds: loopContext?.projectRuleIds,
      environmentIds: loopContext?.environmentIds,
      instructionBodies: loopContext?.instructionBodies,
      evidence,
      windowPolicy,
      continueOverrideCount,
      thresholdOverrides: input.v8LoopPolicy?.thresholds ?? input.loopPolicy?.thresholds,
      repoBuildStateBefore: afterState ?? repoBuildStateBefore,
      logVerbosity: input.logVerbosity,
      criticMode: resolveSteeringFeatureFlags(input.steering).criticMode,
    });
    if (
      currentOutcome.kind === "completed" ||
      currentOutcome.kind === "approval_required" ||
      currentOutcome.kind === "continue_required" ||
      currentOutcome.kind === "grant_expansion_required"
    ) {
      decision = currentOutcome.decision;
      return {
        kind: "continue",
        state: {
          currentOutcome,
          decision,
          afterState,
          repairAttempts,
          previousAfterErrorCount,
          consecutiveStalledRepairs,
        },
      };
    }
    if (currentOutcome.kind === "cancelled") {
      await runtime.safeUnpin(runId, pinnedState);
      return { kind: "return", result: await cancelledResult() };
    }
    if (currentOutcome.kind === "failed") {
      await runtime.safeUnpin(runId, pinnedState);
      return { kind: "return", result: finish({
        status: "failed",
        answer: currentOutcome.answer,
        reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
        error: currentOutcome.error,
      }) };
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
  // Finalize verification evidence and memory before suspending. This makes
  // Stop a clean terminal choice with a durable summary/retry record.
  if (
    verificationOutcome.repairable &&
    currentOutcome.kind === "completed" &&
    loopChangedFiles.length > 0
  ) {
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
  }
  await runtime.safeUnpin(runId, pinnedState);
  reasonCodes.push("answer_produced");
  const status = resolveFailedVerificationTerminalStatus({
    changedFileCount: loopChangedFiles.length,
    rejectKind: verificationOutcome.rejectKind,
  });
  if (status === "failed" && verificationOutcome.rejectKind === "no_mutation_performed") {
    reasonCodes.push("no_mutation_performed", "incomplete_execute");
  }
  return { kind: "return", result: finish({
    status,
    answer: selectUserFacingLoopAnswer({
      loopAnswer:
        "answer" in currentOutcome ? currentOutcome.answer : loopAnswer,
      fallbackSummary: summary,
      changedFiles: loopChangedFiles,
    }),
    reasonCodes,
    error: status === "failed" ? verificationOutcome.error : undefined,
  }) };
}

async function loadRepairSourceLines(params: {
  workspaceRoot: string | undefined;
  verification: import("../../../modules/verification").VerificationResult | undefined;
}): Promise<ReadonlyMap<string, string> | undefined> {
  if (!params.workspaceRoot || !params.verification) {
    return undefined;
  }
  try {
    const lines = await loadDiagnosticSourceLines({
      workspaceRoot: params.workspaceRoot,
      diagnostics: params.verification.diagnostics,
    });
    return lines.size > 0 ? lines : undefined;
  } catch {
    return undefined;
  }
}
