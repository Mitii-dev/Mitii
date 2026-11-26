/**
 * Attempt one verification repair model/tool loop when the failed gate is repairable.
 */
import type { ModelRequest } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type {
  RepoBuildState,
  VerificationResult,
} from "../../../modules/verification";

import {
  buildVerificationRepairPrompt,
  loadDiagnosticSourceLines,
  nextStalledRepairCount,
  resolveLoopPolicyThresholds,
  shouldContinueVerificationRepair,
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
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import type { VerificationGateOutcome } from "./types";
import { runV8ModelLoop } from "./modelLoop";
import type { VerificationRepairState } from "./verificationFinishFailedTypes";
import type { FinishAfterLoopFinish } from "./verificationFinishTypes";

type FailedGate = Extract<VerificationGateOutcome, { kind: "failed" }>;

export async function tryVerificationRepairAttempt(params: {
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
  finish: FinishAfterLoopFinish;
  cancelledResult: () => Promise<AgentRunResult>;
  taskListRef: TaskListRef;
  repoBuildStateBefore?: RepoBuildState;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
  loopContext?: {
    understanding?: import("../../../modules/request-understanding").RequestUnderstandingResult;
    skillsQuery?: string;
    mode?: "ask" | "plan" | "agent";
    memoryFacts?: readonly { id: string; content: string }[];
    memoryQuery?: string;
    memoryWorkspaceId?: string;
    memoryFileTargets?: readonly string[];
    establishedFacts?: import("../actions").EstablishedFact[];
    selectedSkillIds?: string[];
    projectRuleIds?: string[];
    environmentIds?: string[];
    instructionBodies?: import("../internal/system-context").InstructionBodiesByKind;
    plan?: import("../../../modules/planning").PlanArtifact;
    executionSeed?: import("../modules/execution-seed").ExecutionSeed;
  };
  verificationOutcome: FailedGate;
  loopChangedFiles: string[];
  loopMutationIds: string[];
  thresholds: ReturnType<typeof resolveLoopPolicyThresholds>["thresholds"];
  continueOverrideCount: number;
  dirtyPaths: readonly string[] | undefined;
  state: VerificationRepairState;
}): Promise<
  | { kind: "continue"; state: VerificationRepairState }
  | { kind: "return"; result: AgentRunResult }
  | { kind: "exhausted"; state: VerificationRepairState }
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
    evidence,
    windowPolicy,
    loopContext,
    verificationOutcome,
    loopChangedFiles,
    loopMutationIds,
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
    // Near the host wall-time budget a repair turn cannot finish + re-verify;
    // report the failed gate with partial results instead.
    canStartModelCall:
      budget.canStartModelCall() && !budget.isNearWallDeadline(),
    maxAttempts: windowPolicy.run.maxVerificationRepairs,
    thresholds,
  });
  const canRepair =
    verificationOutcome.repairable &&
    repairDecision.continue &&
    currentOutcome.kind === "completed";

  if (!(canRepair && currentOutcome.kind === "completed")) {
    return {
      kind: "exhausted",
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
    thresholdOverrides:
      input.v8LoopPolicy?.thresholds ?? input.loopPolicy?.thresholds,
    repoBuildStateBefore: afterState ?? params.repoBuildStateBefore,
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
    return {
      kind: "return",
      result: finish({
        status: "failed",
        answer: currentOutcome.answer,
        reasonCodes: [...reasonCodes, ...currentOutcome.extraReasons],
        error: currentOutcome.error,
      }),
    };
  }
  reasonCodes.push("budget_exhausted");
  return {
    kind: "exhausted",
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

async function loadRepairSourceLines(params: {
  workspaceRoot: string | undefined;
  verification: VerificationResult | undefined;
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
