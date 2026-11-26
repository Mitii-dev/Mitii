/**
 * Prepare repair task list, inject repair prompt, and run one repair model loop.
 */
import type { ModelRequest } from "../../../modules/model-gateway";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import type { RepoBuildState } from "../../../modules/verification";

import { resolveSteeringFeatureFlags } from "../legacy/steeringFlags";
import {
  prepareRepairWorkingSet,
  planProgressOf,
  type TaskListRef,
} from "../internal/taskListRuntime";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { AgentEngineRuntime } from "./runtime";
import type { VerificationGateOutcome } from "./types";
import { runV8ModelLoop } from "./modelLoop";
import type { VerificationRepairState } from "./verificationFinishFailedTypes";
import { buildVerificationRepairUserContent } from "./verificationFinishRepairPrompt";

type FailedGate = Extract<VerificationGateOutcome, { kind: "failed" }>;
type CompletedOutcome = Extract<
  VerificationRepairState["currentOutcome"],
  { kind: "completed" }
>;

export async function runVerificationRepairLoop(params: {
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
  taskListRef: TaskListRef;
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
  continueOverrideCount: number;
  dirtyPaths: readonly string[] | undefined;
  repoBuildStateBefore?: RepoBuildState;
  state: {
    currentOutcome: CompletedOutcome;
    decision: VerificationRepairState["decision"];
    afterState: VerificationRepairState["afterState"];
    repairAttempts: number;
    previousAfterErrorCount: number | undefined;
    consecutiveStalledRepairs: number;
  };
}): Promise<VerificationRepairState> {
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
    taskListRef,
    evidence,
    windowPolicy,
    loopContext,
    verificationOutcome,
    loopChangedFiles,
    loopMutationIds,
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
    content: await buildVerificationRepairUserContent({
      verification: verificationOutcome.verification,
      comparison: verificationOutcome.comparison,
      changedFiles: loopChangedFiles,
      decision,
      workspaceRoot: input.workspaceRoot,
      askScopePaths: [
        ...(loopContext?.executionSeed?.paths ?? []),
        ...(loopContext?.memoryFileTargets ?? []),
        ...loopChangedFiles,
      ],
      userPrompt: loopContext?.skillsQuery ?? loopContext?.memoryQuery ?? "",
      activeBatch: repairPrep.activeItem,
    }),
  });
  const nextOutcome = await runV8ModelLoop(runtime, {
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
    nextOutcome.kind === "completed" ||
    nextOutcome.kind === "approval_required" ||
    nextOutcome.kind === "continue_required" ||
    nextOutcome.kind === "grant_expansion_required"
  ) {
    decision = nextOutcome.decision;
  }

  return {
    currentOutcome: nextOutcome,
    decision,
    afterState,
    repairAttempts,
    previousAfterErrorCount,
    consecutiveStalledRepairs,
  };
}
