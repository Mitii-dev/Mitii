/**
 * Soft gates before tool execute: change-impact + must-read nudge rejects.
 */
import {
  TOOL_RUNTIME_SCHEMA_VERSION,
  toolResultSchema,
} from "../../tool-runtime";

import {
  extractMutationTargetPaths,
  missingMustReadPaths,
  buildMustReadNudgeMessage,
  serializeToolResultForModel,
} from "../actions";
import type { ToolCallOutcome } from "./types";
import { toolCompletionDiagnostics } from "./executeToolSupport";
import { isChangeImpactGatedToolName } from "./executeToolFinishHelpers";
import type { ExecuteToolContinueContext } from "./executeToolFinishTypes";
import type { AgentEngineRuntime } from "./runtime";

export function rejectIfChangeImpactOrMustReadGate(
  runtime: AgentEngineRuntime,
  ctx: ExecuteToolContinueContext,
): ToolCallOutcome | undefined {
  const {
    toolCall,
    argumentsValue,
    summary,
    mutatingToolNames,
    changeImpactGate,
    changeImpactNudgeBudget,
    mustReadNudgeBudget,
    taskListRef,
    establishedFacts,
    loopFileReads,
    windowPolicy,
    toolCache,
    warnings,
    reasonCodes,
    bus,
    runId,
  } = ctx;

  if (
    changeImpactGate?.required &&
    !changeImpactGate.satisfied &&
    isChangeImpactGatedToolName(toolCall.name) &&
    (changeImpactNudgeBudget?.remaining ?? 0) > 0
  ) {
    changeImpactNudgeBudget!.remaining -= 1;
    reasonCodes.push("change_impact_gate_blocked");
    reasonCodes.push("change_impact_incomplete");
    const message =
      "analyze_change_impact is required before the first mutating edit on this run (change_impact_recommended). Call analyze_change_impact on the primary seed path, then retry the mutation.";
    warnings.push(message);
    const now = runtime.isoNow();
    const result = toolResultSchema.parse({
      schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: "rejected",
      reasonCode: "change_impact_incomplete",
      output: {
        message,
        requiredTool: "analyze_change_impact",
      },
      truncated: false,
      redacted: false,
      durationMs: 0,
      bytesProduced: 0,
      warnings: [message],
      audit: {
        callId: toolCall.id,
        toolName: toolCall.name,
        startedAt: now,
        endedAt: now,
        status: "rejected",
        reasonCode: "change_impact_incomplete",
        inputPreview: toolCall.name,
        outputPreview: message,
        bytesProduced: 0,
        durationMs: 0,
        truncated: false,
        redacted: false,
      },
    });
    toolCache.set(toolCall.id, result);
    runtime.emit(bus, {
      type: "tool_completed",
      runId,
      callId: toolCall.id,
      toolName: toolCall.name,
      status: result.status,
      ...(summary ? { summary } : {}),
      ...toolCompletionDiagnostics(result),
      at: runtime.isoNow(),
    });
    return {
      kind: "message",
      message: {
        role: "tool",
        toolCallId: toolCall.id,
        content: serializeToolResultForModel(result, {
          maxContentChars: windowPolicy.compaction.toolResultContentChars,
        }),
      },
    };
  }

  if (
    changeImpactGate?.required &&
    !changeImpactGate.satisfied &&
    isChangeImpactGatedToolName(toolCall.name)
  ) {
    warnings.push(
      "Proceeding with the mutating edit before analyze_change_impact after the change-impact nudge budget was exhausted. Prefer calling it on the primary seed when useful.",
    );
  }

  if (
    mutatingToolNames.has(toolCall.name) &&
    (mustReadNudgeBudget?.remaining ?? 0) > 0
  ) {
    const mutationPaths = extractMutationTargetPaths(
      toolCall.name,
      argumentsValue,
    );
    const missing = missingMustReadPaths({
      taskList: taskListRef?.current,
      mutationPaths,
      loopFileReads,
      establishedFacts,
    });
    if (missing.length > 0) {
      mustReadNudgeBudget!.remaining -= 1;
      reasonCodes.push("must_read_nudged");
      const message = buildMustReadNudgeMessage({
        missing,
        mutationPaths,
      });
      warnings.push(message);
      const now = runtime.isoNow();
      const result = toolResultSchema.parse({
        schemaVersion: TOOL_RUNTIME_SCHEMA_VERSION,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: "rejected",
        reasonCode: "must_read_incomplete",
        output: {
          missingMustRead: missing,
          write: mutationPaths,
          message,
        },
        truncated: false,
        redacted: false,
        durationMs: 0,
        bytesProduced: 0,
        warnings: [message],
        audit: {
          callId: toolCall.id,
          toolName: toolCall.name,
          startedAt: now,
          endedAt: now,
          status: "rejected",
          reasonCode: "must_read_incomplete",
          inputPreview: toolCall.name,
          outputPreview: message,
          bytesProduced: 0,
          durationMs: 0,
          truncated: false,
          redacted: false,
        },
      });
      toolCache.set(toolCall.id, result);
      runtime.emit(bus, {
        type: "tool_completed",
        runId,
        callId: toolCall.id,
        toolName: toolCall.name,
        status: result.status,
        ...(summary ? { summary } : {}),
        ...toolCompletionDiagnostics(result),
        at: runtime.isoNow(),
      });
      return {
        kind: "message",
        message: {
          role: "tool",
          toolCallId: toolCall.id,
          content: serializeToolResultForModel(result, {
            maxContentChars: windowPolicy.compaction.toolResultContentChars,
          }),
        },
      };
    }
  }

  return undefined;
}
