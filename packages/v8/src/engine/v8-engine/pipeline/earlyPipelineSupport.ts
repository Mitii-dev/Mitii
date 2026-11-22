import type { UserRequestEnvelope } from "../../../modules/request-intake";
import { extractPrimaryUserMessage } from "../../../modules/request-understanding";
import { extractMentionedPaths } from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
} from "../contracts";
import type { SessionControlRunResult } from "../contracts/output/AgentRunResult";
import type { EventBus } from "../internal/EventBus";
import type { handleMetaCommand } from "../modules/session-control";
import { capturePreflightBuildState } from "./pinAndDiscovery";
import type { ExecuteStartSharedState } from "./executeStartEarlyPipeline";
import type { AgentEngineRuntime } from "./runtime";
import { resolveWorkspaceId } from "./runtime";
import {
  persistVerificationArtifact,
  tryLoadVerificationRetry,
} from "./verification";

/** Map a handled meta command into the public session-control result shape. */
export function buildSessionControlResult(
  handled: ReturnType<typeof handleMetaCommand>,
): SessionControlRunResult {
  return {
    command: handled.command,
    lifecycle: handled.lifecycle,
    answer: handled.answer,
    ...(handled.sessionAction
      ? { sessionAction: handled.sessionAction }
      : {}),
    ...(handled.compactedConversation
      ? {
          compactedConversation: [
            ...handled.compactedConversation,
          ] as SessionControlRunResult["compactedConversation"],
        }
      : {}),
    ...(handled.compactStats
      ? {
          compactStats: {
            beforeMessages: handled.compactStats.beforeMessages,
            afterMessages: handled.compactStats.afterMessages,
            omittedTokens: handled.compactStats.omittedTokens,
            pressure: handled.compactStats.pressure,
            stagesApplied: [...handled.compactStats.stagesApplied],
          },
        }
      : {}),
  };
}

/**
 * Agent-mode repair asks: load a stored verification retry record or capture a
 * fresh preflight build state before understanding runs.
 */
export async function captureAgentExecutePreflight(
  runtime: AgentEngineRuntime,
  params: {
    runId: string;
    input: AgentEngineStartInput;
    envelope: UserRequestEnvelope;
    bus: EventBus;
    signal: AbortSignal;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
    shared: ExecuteStartSharedState;
  },
): Promise<void> {
  const { runId, input, envelope, bus, signal, reasonCodes, warnings, shared } =
    params;
  const retryRecord = await tryLoadVerificationRetry(runtime, {
    workspaceId: resolveWorkspaceId(input),
    userMessage: extractPrimaryUserMessage(envelope.message),
    runId,
    bus,
    warnings,
    logVerbosity: input.logVerbosity,
  });
  if (retryRecord) {
    shared.repoBuildStateBefore = retryRecord.after ?? retryRecord.before;
    shared.verificationRecord = retryRecord;
    reasonCodes.push("verification_retry_loaded");
    if (shared.repoBuildStateBefore) {
      runtime.emitRepoBuildStateCaptured(bus, runId, shared.repoBuildStateBefore);
    }
  } else {
    shared.repoBuildStateBefore = await capturePreflightBuildState(runtime, {
      runId,
      input,
      pinnedState: shared.pinnedState,
      contextPaths: [],
      bus,
      signal,
      reasonCodes,
      warnings,
      unconditional: true,
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
}
