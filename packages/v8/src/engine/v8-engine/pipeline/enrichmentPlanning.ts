/**
 * Enrichment-tail planning / discovery / post-plan gates.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import {
  inferPlanStrategyFromArtifact,
  serializePlanForPrompt,
  type PlanArtifact,
  type PlanStrategyDecision,
} from "../../../modules/planning";
import type {
  PromptInstructions,
  PromptRepositoryContext,
} from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { recordPlanEvidence } from "../actions";
import {
  refineExecutionSeedFromPlan,
  isExecutionSeedTrusted,
} from "../modules/execution-seed";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
  RunEvidence,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { RunBudgetTracker } from "../internal/RunBudget";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import { runLiveEnrichmentPlanning } from "./enrichmentPlanningDiscover";

export async function runEnrichmentPlanning(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  budget: RunBudgetTracker;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  startedMs: number;
  shared: ExecuteStartSharedState;
  taskListRef: TaskListRef;
  runEvidence: RunEvidence;
  syncTaskListOnce: () => void;
  envelope: UserRequestEnvelope;
  candidateRelativePaths: string[];
  approvedPlan?: PlanArtifact;
  approvedPlanStrategy?: PlanStrategyDecision;
  skipPlanGate: boolean;
  planSource?: "host_carry" | "resume_approval";
  finish: (partial: {
    status: AgentRunStatus;
    route?: AgentRunResult["route"];
    planningDepth?: AgentRunResult["planningDepth"];
    answer?: string;
    plan?: AgentRunResult["plan"];
    suspension?: AgentRunResult["suspension"];
    pinnedState?: import("../../../modules/repository-state").RepositoryStateReference;
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
  repositoryContext: PromptRepositoryContext | undefined;
  contextPaths: string[];
  selectedSkills: PromptInstructions["skills"];
}): Promise<{ planText: string | undefined; terminal?: StartEnrichmentOutcome }> {
  const {
    runtime,
    reasonCodes,
    shared,
    runEvidence,
    approvedPlan,
    approvedPlanStrategy,
    planSource,
    decision,
  } = params;

  // --- Planning (optional) ---
  if (approvedPlan) {
    shared.runPlan = approvedPlan;
    shared.runPlanStrategy =
      approvedPlanStrategy ?? inferPlanStrategyFromArtifact(approvedPlan);
    const planText = serializePlanForPrompt(approvedPlan, shared.runPlanStrategy);
    recordPlanEvidence(runEvidence, approvedPlan);
    runtime.emitEvidenceUpdated(params.bus, params.runId, runEvidence);
    // Resume-from-approval restarts start — promote plan paths so mutate
    // lock is not stuck on the pre-plan weak seed from a pathless prompt.
    const promoted = refineExecutionSeedFromPlan({
      seed: shared.executionSeed,
      plan: approvedPlan,
    });
    if (isExecutionSeedTrusted(promoted)) {
      if (
        !shared.executionSeed ||
        shared.executionSeed.confidence !== "trusted" ||
        promoted.paths.join("\0") !== shared.executionSeed.paths.join("\0")
      ) {
        shared.executionSeed = promoted;
        reasonCodes.push("execution_seed_from_plan");
      }
    }
    if (planSource === "host_carry") {
      reasonCodes.push("plan_drafted", "plan_carried");
    } else {
      reasonCodes.push("plan_drafted", "plan_approved");
    }
    return { planText };
  }

  if (runtime.deps.planning && decision.planningDepth !== "none") {
    return runLiveEnrichmentPlanning({
      runtime: params.runtime,
      runId: params.runId,
      input: params.input,
      bus: params.bus,
      signal: params.signal,
      windowPolicy: params.windowPolicy,
      budget: params.budget,
      reasonCodes,
      warnings: params.warnings,
      startedMs: params.startedMs,
      shared,
      taskListRef: params.taskListRef,
      runEvidence,
      syncTaskListOnce: params.syncTaskListOnce,
      envelope: params.envelope,
      candidateRelativePaths: params.candidateRelativePaths,
      skipPlanGate: params.skipPlanGate,
      finish: params.finish,
      understanding: params.understanding,
      decision,
      repositoryContext: params.repositoryContext,
      contextPaths: params.contextPaths,
      selectedSkills: params.selectedSkills,
    });
  }

  reasonCodes.push("plan_skipped");
  if (decision.reasonCodes.includes("fast_path_explicit_paths")) {
    // No plan and no discovery pass: the execution seed binds the named
    // paths and the mutate loop starts immediately.
    reasonCodes.push("fast_path_plan_skipped");
  }
  return { planText: undefined };
}
