/**
 * Early-start Understand phase + execution-seed resolve.
 */
import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";

import {
  amendMessageWithPriorConversation,
  buildUnderstandingHistoryDigest,
  buildDiagnosticSummary,
  collectUnderstandingCandidatePaths,
} from "../actions";
import {
  isExecutionSeedTrusted,
  resolveExecutionSeed,
  type ExecutionSeed,
} from "../modules/execution-seed";
import type { AgentEngineStartInput, AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import type { AgentEngineRuntime } from "./runtime";
import { applyClarificationResolutionOverlay } from "./clarificationResolutionOverlay";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipelineTypes";

export type EarlyUnderstandResult = {
  understanding: RequestUnderstandingResult;
  understandingEnvelope: UserRequestEnvelope;
  candidateRelativePaths: string[];
  executionSeed: ExecutionSeed;
  diagnosticSummary: ReturnType<typeof buildDiagnosticSummary>;
};

export async function runStartEarlyUnderstand(params: {
  runtime: AgentEngineRuntime;
  runId: string;
  input: AgentEngineStartInput;
  bus: EventBus;
  envelope: UserRequestEnvelope;
  shared: ExecuteStartSharedState;
  reasonCodes: AgentReasonCode[];
}): Promise<EarlyUnderstandResult> {
  const { runtime, runId, input, bus, envelope, shared, reasonCodes } = params;

  runtime.emitStage(bus, runId, "understood", "started");
  const understandingEnvelope: UserRequestEnvelope =
    input.conversation.length > 0
      ? {
          ...envelope,
          message: amendMessageWithPriorConversation(
            envelope.message,
            input.conversation,
            extractPrimaryUserMessage,
          ),
        }
      : envelope;
  const diagnosticSummary = shared.repoBuildStateBefore
    ? buildDiagnosticSummary(
        shared.repoBuildStateBefore,
        extractPrimaryUserMessage(understandingEnvelope.message),
      )
    : undefined;
  // Collect cheap path hints for *post-context* fuzzy resolution only.
  // Do not pass them into early understand(): sparse dirty/diagnostic
  // candidates can uniquely resolve a basename to the wrong file, lock
  // mutation scopes / context focus, and then block later correction.
  const candidateRelativePaths = collectUnderstandingCandidatePaths({
    dirtyPaths: input.dirtyPaths,
    diagnosticSummary,
    referencedArtifacts: understandingEnvelope.referencedArtifacts,
    userMessage: extractPrimaryUserMessage(understandingEnvelope.message),
  });
  const historyDigest = buildUnderstandingHistoryDigest(
    input.conversation ?? [],
  );
  // S2-RU: assessment ballot path — no RuleIntent dual-path merge.
  const understandingRaw = await runtime.deps.understanding.understand(
    understandingEnvelope,
    {
      useAssessmentBallot: true,
      ...(diagnosticSummary ? { diagnosticSummary } : {}),
      ...(historyDigest ? { historyDigest } : {}),
      ...(input.requiredMcpServerIds && input.requiredMcpServerIds.length > 0
        ? { requiredMcpServerIds: [...input.requiredMcpServerIds] }
        : {}),
    },
  );
  const understanding = applyClarificationResolutionOverlay(
    understandingRaw,
    input.clarificationResolution,
  );
  reasonCodes.push("understanding_complete");
  runtime.emitStage(bus, runId, "understood", "completed", [
    "understanding_complete",
  ]);

  const executionSeed = resolveExecutionSeed({
    userPrompt: extractPrimaryUserMessage(understandingEnvelope.message),
    understanding,
    repoBuildStateBefore: shared.repoBuildStateBefore,
    ...(diagnosticSummary ? { diagnosticSummary } : {}),
  });
  shared.executionSeed = executionSeed;
  reasonCodes.push(
    isExecutionSeedTrusted(executionSeed)
      ? "execution_seed_trusted"
      : "execution_seed_weak",
  );

  return {
    understanding,
    understandingEnvelope,
    candidateRelativePaths,
    executionSeed,
    diagnosticSummary,
  };
}
