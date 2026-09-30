import type { ExecutionDecision } from "../../../modules/decision-policy";
import { toolGrantsEquivalent } from "../../../modules/decision-policy";
import type {
  PlanArtifact,
  PlanStrategyDecision,
} from "../../../modules/planning";
import type { PromptRepositoryContext } from "../../../modules/prompt-construction";
import { mapContextToPromptSlice } from "../../../modules/prompt-construction";
import { deriveContextSelectionBudget } from "../../../modules/repository-context";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding/intent/extractPrimaryUserMessage";
import {
  resolveFuzzyFileTargets,
  type RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  extractMentionedPaths,
  CONTEXT_READY_VERBOSE_WARNING_CODES,
  CONTEXT_READY_WARNING_CODES,
  deriveContextFocusFromUnderstanding,
  scopeDiscoveredContextPaths,
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
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { TaskListRef } from "../internal/taskListRuntime";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import { capturePreflightBuildState } from "./pinAndDiscovery";
import { persistVerificationArtifact } from "./verification";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import { finishEnrichmentSkillsMemoryPlan } from "./executeStartEnrichmentTail";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";

export type {
  StartEnrichmentContinue,
  StartEnrichmentOutcome,
} from "./executeStartEnrichmentTypes";

/** Context → Skills → Memory → Planning. */
export async function runStartEnrichment(
  runtime: AgentEngineRuntime,
  params: {
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
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
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
    pinnedState?: RepositoryStateReference;
    reasonCodes?: AgentReasonCode[];
    warnings?: string[];
    error?: { code: string; message: string };
  }) => AgentRunResult;
  cancelledResult: () => Promise<AgentRunResult>;
}): Promise<StartEnrichmentOutcome> {
  const {
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    runEvidence,
    syncTaskListOnce,
    envelope,
    candidateRelativePaths,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate,
    planSource,
    finish,
    cancelledResult,
  } = params;
  let { understanding, decision } = params;

  // --- Context ---
  let repositoryContext: PromptRepositoryContext | undefined;
  let contextPaths: string[] = [];

  if (decision.repositoryContextRequired) {
    if (!runtime.deps.repositoryContext || !shared.pinnedState) {
      reasonCodes.push("state_unavailable");
      await runtime.safeUnpin(runId, shared.pinnedState);
      return {
        kind: "terminal",
        result: finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "state_unavailable",
            message:
              "Repository context is required but state/context ports are unavailable.",
          },
        }),
      };
    }

    runtime.emitStage(bus, runId, "context_ready", "started");
    const contextQuery = extractPrimaryUserMessage(envelope.message);
    const contextFocus = deriveContextFocusFromUnderstanding(understanding);
    const contextResult = await runtime.deps.repositoryContext.execute({
      state: shared.pinnedState,
      query: contextQuery,
      mode: envelope.mode,
      selectionBudget: deriveContextSelectionBudget(
        runtime.deps.llm.capabilities.contextWindowTokens,
        { maximumTokens: windowPolicy.sections.repositoryTokens },
      ),
      ...(contextFocus.folderPrefix
        ? { folderPrefix: contextFocus.folderPrefix }
        : {}),
      ...(contextFocus.filePaths.length > 0
        ? { filePaths: contextFocus.filePaths }
        : {}),
      ...(contextFocus.kinds.length > 0
        ? { kinds: contextFocus.kinds }
        : {}),
      ...(contextFocus.references
        ? { references: contextFocus.references }
        : {}),
      abortSignal: signal,
    });

    if (signal.aborted || contextResult.status === "cancelled") {
      await runtime.safeUnpin(runId, shared.pinnedState);
      return { kind: "terminal", result: await cancelledResult() };
    }

    if (contextResult.status === "failed") {
      reasonCodes.push("context_failed");
      await runtime.safeUnpin(runId, shared.pinnedState);
      return {
        kind: "terminal",
        result: finish({
          status: "failed",
          reasonCodes,
          error: {
            code: "context_failed",
            message: "Repository context retrieval failed.",
          },
        }),
      };
    }

    repositoryContext = mapContextToPromptSlice(contextResult);
    reasonCodes.push("context_retrieved");
    const discoveredPaths = contextResult.assembly.blocks
      .map((block) => block.relativePath)
      .filter((path): path is string => Boolean(path?.trim()));
    // Fuzzy-resolve basenames against retrieved paths (+ dirty/@ hints).
    if (discoveredPaths.length > 0) {
      const fuzzy = resolveFuzzyFileTargets(
        understanding.taskAnalysis.targets,
        [...candidateRelativePaths, ...discoveredPaths],
      );
      if (fuzzy.resolved.length > 0) {
        understanding = {
          ...understanding,
          taskAnalysis: {
            ...understanding.taskAnalysis,
            targets: fuzzy.targets,
          },
        };
      }
    }
    const scopedFocus = deriveContextFocusFromUnderstanding(understanding);
    contextPaths = scopeDiscoveredContextPaths(discoveredPaths, scopedFocus);
    runtime.emit(bus, {
      type: "context_ready",
      runId,
      stateToken: contextResult.stateToken,
      blockCount: contextResult.assembly.blocks.length,
      retrievedCandidates: contextResult.statistics.retrievedCandidates,
      selectedItems: contextResult.statistics.selectedItems,
      droppedBlocks: contextResult.statistics.droppedBlocks,
      status: contextResult.status,
      ...(contextPaths.length > 0 ? { paths: contextPaths } : {}),
      ...(contextResult.retrieval?.sourceReports &&
      contextResult.retrieval.sourceReports.length > 0
        ? {
            retrievalSources: contextResult.retrieval.sourceReports
              .slice(0, 8)
              .map((report) => ({
                sourceId: report.sourceId,
                status: report.status,
                candidateCount: report.candidateCount,
                ...(report.status === "failed" && report.error
                  ? { error: report.error.slice(0, 300) }
                  : {}),
              })),
          }
        : {}),
      at: runtime.isoNow(),
    });
    for (const warning of contextResult.warnings) {
      const standard = CONTEXT_READY_WARNING_CODES.has(warning.code);
      const verboseOnly = CONTEXT_READY_VERBOSE_WARNING_CODES.has(
        warning.code,
      );
      if (!standard && !verboseOnly) continue;
      if (!logVerbosityAtLeast(input.logVerbosity, standard ? "standard" : "verbose")) {
        continue;
      }
      runtime.emit(bus, {
        type: "warning",
        runId,
        message: warning.message,
        code: warning.code,
        stage: "context_ready",
        at: runtime.isoNow(),
      });
    }
    runtime.emitStage(bus, runId, "context_ready", "completed", [
      "context_retrieved",
    ]);
  } else {
    reasonCodes.push("context_skipped");
  }

  if (signal.aborted) {
    await runtime.safeUnpin(runId, shared.pinnedState);
    return { kind: "terminal", result: await cancelledResult() };
  }

  if (runtime.deps.decision.narrow) {
    const narrowed = runtime.deps.decision.narrow({
      previous: decision,
      discoveredPaths: contextPaths,
      residualRisk: understanding.taskAnalysis.risk,
    });
    if (
      !toolGrantsEquivalent(decision.toolGrant, narrowed.toolGrant)
    ) {
      decision = narrowed;
      reasonCodes.push("grant_narrowed");
      runtime.emit(bus, {
        type: "grant_narrowed",
        runId,
        maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
        approvalMode: decision.toolGrant.approvalMode,
        pathScopes: decision.toolGrant.pathScopes.slice(0, 20),
        reasonCodes: decision.reasonCodes.slice(-8),
        truncated:
          decision.toolGrant.pathScopes.length > 20 ||
          decision.reasonCodes.length > 8
            ? true
            : undefined,
        at: runtime.isoNow(),
      });
    }
  }

  // Plan-mode repair-intent capture when early Agent preflight was skipped.
  if (!shared.repoBuildStateBefore) {
    shared.repoBuildStateBefore = await capturePreflightBuildState(runtime, {
      runId,
      decision,
      understanding,
      input,
      pinnedState: shared.pinnedState,
      contextPaths,
      bus,
      signal,
      reasonCodes,
      warnings,
      mentionedPaths: extractMentionedPaths(
        extractPrimaryUserMessage(envelope.message),
      ),
    });
    if (shared.repoBuildStateBefore) {
      runtime.emitRepoBuildStateCaptured(bus, runId, shared.repoBuildStateBefore);
      shared.verificationRecord =
        (await persistVerificationArtifact(runtime, {
          runId,
          requestId: shared.requestId,
          workspaceId: resolveWorkspaceId(input),
          bus,
          reasonCodes,
          warnings,
          status: "captured_before",
          before: shared.repoBuildStateBefore,
          previous: shared.verificationRecord,
          logVerbosity: input.logVerbosity,
        })) ?? shared.verificationRecord;
    }
  }


  return finishEnrichmentSkillsMemoryPlan(runtime, {
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    budget,
    reasonCodes,
    warnings,
    startedMs,
    shared,
    taskListRef,
    runEvidence,
    syncTaskListOnce,
    envelope,
    candidateRelativePaths,
    approvedPlan,
    approvedPlanStrategy,
    skipPlanGate,
    planSource,
    finish,
    cancelledResult,
    understanding,
    decision,
    repositoryContext,
    contextPaths,
  });
}
