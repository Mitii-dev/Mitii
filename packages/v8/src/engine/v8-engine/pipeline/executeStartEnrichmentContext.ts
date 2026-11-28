/**
 * Enrichment context retrieval, grant narrow, and deferred preflight capture.
 */
import type { ExecutionDecision } from "../../../modules/decision-policy";
import { toolGrantsEquivalent } from "../../../modules/decision-policy";
import type { PromptRepositoryContext } from "../../../modules/prompt-construction";
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import type { WindowPolicy } from "../../../modules/window-budget";

import { extractMentionedPaths } from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  AgentRunResult,
  AgentRunStatus,
} from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import { capturePreflightBuildState } from "./pinAndDiscovery";
import { persistVerificationArtifact } from "./verification";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { StartEnrichmentOutcome } from "./executeStartEnrichmentTypes";
import type { RepositoryStateReference } from "../../../modules/repository-state";
import { retrieveEnrichmentRepositoryContext } from "./executeStartEnrichmentContextRetrieve";

export type EnrichmentContextResult =
  | Extract<StartEnrichmentOutcome, { kind: "terminal" }>
  | {
      kind: "ready";
      understanding: RequestUnderstandingResult;
      decision: ExecutionDecision;
      repositoryContext: PromptRepositoryContext | undefined;
      contextPaths: string[];
    };

export async function runEnrichmentContext(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  signal: AbortSignal;
  windowPolicy: WindowPolicy;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  shared: ExecuteStartSharedState;
  envelope: UserRequestEnvelope;
  understanding: RequestUnderstandingResult;
  decision: ExecutionDecision;
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
}): Promise<EnrichmentContextResult> {
  const {
    runtime,
    runId,
    input,
    bus,
    signal,
    windowPolicy,
    reasonCodes,
    warnings,
    shared,
    envelope,
    candidateRelativePaths,
    finish,
    cancelledResult,
  } = params;
  let { understanding, decision } = params;

  let repositoryContext: PromptRepositoryContext | undefined;
  let contextPaths: string[] = [];

  if (decision.repositoryContextRequired) {
    const retrieved = await retrieveEnrichmentRepositoryContext({
      runtime,
      runId,
      input,
      bus,
      signal,
      windowPolicy,
      reasonCodes,
      shared,
      envelope,
      understanding,
      candidateRelativePaths,
      finish,
      cancelledResult,
    });
    if (retrieved.kind === "terminal") {
      return retrieved;
    }
    understanding = retrieved.understanding;
    repositoryContext = retrieved.repositoryContext;
    contextPaths = retrieved.contextPaths;
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
    if (!toolGrantsEquivalent(decision.toolGrant, narrowed.toolGrant)) {
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
      runtime.emitRepoBuildStateCaptured(
        bus,
        runId,
        shared.repoBuildStateBefore,
      );
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

  return {
    kind: "ready",
    understanding,
    decision,
    repositoryContext,
    contextPaths,
  };
}
