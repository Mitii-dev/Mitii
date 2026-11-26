/**
 * Repository context retrieval + path/seed refinement for start enrichment.
 */
import type { PromptRepositoryContext } from "../../../modules/prompt-construction";
import { mapContextToPromptSlice } from "../../../modules/prompt-construction";
import { deriveContextSelectionBudget } from "../../../modules/repository-context";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import {
  resolveFuzzyFileTargets,
  type RequestUnderstandingResult,
} from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import {
  CONTEXT_READY_VERBOSE_WARNING_CODES,
  CONTEXT_READY_WARNING_CODES,
  buildPlanningQuery,
  deriveContextFocusFromUnderstanding,
  extractPriorPathHints,
  isPlanningFollowUp,
  mergeContextFocusWithPriorPathHints,
  mergeContextPathsWithPriorHints,
  resolvePriorPathHintBudget,
  scopeDiscoveredContextPaths,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import { logVerbosityAtLeast } from "../internal/logVerbosity";
import type { AgentEngineRuntime } from "./runtime";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import { refineExecutionSeedFromContext } from "../modules/execution-seed";
import type { RepositoryStateReference } from "../../../modules/repository-state";

export type EnrichmentContextRetrieveResult =
  | {
      kind: "terminal";
      result: AgentRunResult;
    }
  | {
      kind: "ready";
      understanding: RequestUnderstandingResult;
      repositoryContext: PromptRepositoryContext | undefined;
      contextPaths: string[];
    };

export async function retrieveEnrichmentRepositoryContext(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  shared: ExecuteStartSharedState;
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  candidateRelativePaths: string[];
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
}): Promise<EnrichmentContextRetrieveResult> {
  const {
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    reasonCodes,
    shared,
    envelope,
    candidateRelativePaths,
    finish,
    cancelledResult,
  } = params;
  let understanding = params.understanding;

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
  const liveQuery = extractPrimaryUserMessage(envelope.message);
  const conversation = input.conversation ?? [];
  const planFollowUp =
    envelope.mode === "plan" || isPlanningFollowUp(liveQuery, conversation);
  // Plan / follow-up: retrieve against the merged prior ask + guidance, not
  // only the short "plan the above" prompt.
  const contextQuery = planFollowUp
    ? buildPlanningQuery(liveQuery, conversation)
    : liveQuery;
  const priorPathHints = extractPriorPathHints(conversation, {
    max: resolvePriorPathHintBudget({
      currentQuery: liveQuery,
      conversation,
      mode: envelope.mode,
    }),
  });
  let contextFocus = deriveContextFocusFromUnderstanding(understanding);
  if (priorPathHints.length > 0 && planFollowUp) {
    contextFocus = mergeContextFocusWithPriorPathHints(
      contextFocus,
      priorPathHints,
    );
    reasonCodes.push("plan_prior_path_hints_carried");
  }
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
    ...(contextFocus.kinds.length > 0 ? { kinds: contextFocus.kinds } : {}),
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

  const repositoryContext = mapContextToPromptSlice(contextResult);
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
  let contextPaths = scopeDiscoveredContextPaths(discoveredPaths, scopedFocus);
  // Keep Ask-touched paths even when retrieval collapses to one file.
  if (priorPathHints.length > 0 && planFollowUp) {
    const before = contextPaths.join("\0");
    contextPaths = mergeContextPathsWithPriorHints({
      contextPaths,
      priorPathHints,
    });
    if (
      contextPaths.join("\0") !== before &&
      !reasonCodes.includes("plan_prior_path_hints_carried")
    ) {
      reasonCodes.push("plan_prior_path_hints_carried");
    }
  }
  if (shared.executionSeed && contextPaths.length > 0) {
    const refined = refineExecutionSeedFromContext({
      seed: shared.executionSeed,
      contextPaths,
      userPrompt: extractPrimaryUserMessage(envelope.message),
    });
    if (refined.paths.join("\0") !== shared.executionSeed.paths.join("\0")) {
      shared.executionSeed = refined;
      reasonCodes.push("execution_seed_context_refined");
    }
  }
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
    const verboseOnly = CONTEXT_READY_VERBOSE_WARNING_CODES.has(warning.code);
    if (!standard && !verboseOnly) continue;
    if (
      !logVerbosityAtLeast(
        input.logVerbosity,
        standard ? "standard" : "verbose",
      )
    ) {
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

  return {
    kind: "ready",
    understanding,
    repositoryContext,
    contextPaths,
  };
}
