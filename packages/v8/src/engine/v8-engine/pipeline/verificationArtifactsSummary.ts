/**
 * Verification user summary, LLM narration, memory commit, retry load.
 */
import type { ModelRequest } from "../../../modules/model-gateway";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { MemoryCommitInput } from "../../../modules/memory";
import { buildVerificationUserSummary } from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationRecord,
  VerificationResult,
} from "../../../modules/verification";

import { formatVerificationFailureAnswer } from "../actions";
import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";
import type { AgentEngineRuntime } from "./runtime";
import { isVerificationRetryAsk } from "./verificationRetryAsk";

export async function summarizeVerificationForUser(
  runtime: AgentEngineRuntime,
  params: {
    bus: EventBus;
    runId: string;
    record?: VerificationRecord;
    verification?: VerificationResult;
    error: { code: string; message: string };
    before?: RepoBuildState;
    after?: RepoBuildState;
    comparison?: RepoBuildStateComparison;
    changedFiles: readonly string[];
    signal: AbortSignal;
    logVerbosity: AgentLogVerbosity;
  },
): Promise<string> {
  const fallback = params.record
    ? buildVerificationUserSummary(params.record)
    : formatVerificationFailureAnswer({
        error: params.error,
        verification: params.verification,
        changedFiles: params.changedFiles,
        rolledBack: false,
      });
  const narration = await tryNarrateVerificationSummary(runtime, {
    record: params.record,
    fallback,
    signal: params.signal,
  });
  if (
    narration.skippedReason &&
    logVerbosityAtLeast(params.logVerbosity, "verbose")
  ) {
    // Not a run failure — the deterministic fallback summary is always
    // correct — but without this, "narration ran and was rejected" and
    // "narration wasn't attempted" are indistinguishable in logs.
    runtime.emit(params.bus, {
      type: "warning",
      runId: params.runId,
      message: `LLM verification-summary narration was skipped (${narration.skippedReason}); used the deterministic summary instead.`,
      code: "verification_narration_failed",
      data: { skippedReason: narration.skippedReason },
      at: runtime.isoNow(),
    });
  }
  const summary = narration.text ?? fallback;
  runtime.emit(params.bus, {
    type: "verification_summary_ready",
    runId: params.runId,
    summaryChars: summary.length,
    newErrorCount:
      params.comparison?.newErrorCount ??
      params.record?.comparison?.newErrorCount,
    remainingErrorCount:
      params.comparison?.remainingErrorCount ??
      params.record?.comparison?.remainingErrorCount,
    clearedErrorCount:
      params.comparison?.clearedErrorCount ??
      params.record?.comparison?.clearedErrorCount,
    at: runtime.isoNow(),
  });
  return summary;
}

export async function tryNarrateVerificationSummary(
  runtime: AgentEngineRuntime,
  params: {
    record?: VerificationRecord;
    fallback: string;
    signal: AbortSignal;
  },
): Promise<
  | { text: string; skippedReason?: undefined }
  | { text?: undefined; skippedReason?: string }
> {
  if (!params.record || params.signal.aborted) {
    return { skippedReason: undefined };
  }
  try {
    const request: ModelRequest = {
      messages: [
        {
          role: "system",
          content:
            "Write a short user-facing summary of a verification delta. Do not invent errors. Do not call tools. Keep the numeric counts from the evidence. Four to eight sentences.",
        },
        {
          role: "user",
          content: params.fallback,
        },
      ],
    };
    let text = "";
    let sawToolCall = false;
    for await (const event of runtime.deps.llm.complete(request, {
      abortSignal: params.signal,
    })) {
      if (event.type === "content_delta" && event.content) {
        text += event.content;
      }
      if (event.type === "tool_call_delta") {
        sawToolCall = true;
      }
      if (event.type === "failed" || event.type === "cancelled") {
        return { skippedReason: `llm_${event.type}` };
      }
    }
    const trimmed = text.trim();
    if (
      sawToolCall ||
      trimmed.length < 20 ||
      !/\b(error|verification|cleared|remaining|kept the edits)\b/i.test(
        trimmed,
      )
    ) {
      return { skippedReason: "rejected_quality_gate" };
    }
    return { text: trimmed.slice(0, 4_000) };
  } catch (error) {
    return { skippedReason: `llm_error:${describeCaughtError(error)}` };
  }
}

export async function commitVerificationMemory(
  runtime: AgentEngineRuntime,
  params: {
    record?: VerificationRecord;
    summary: string;
    workspaceId?: string;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  },
): Promise<void> {
  if (!runtime.deps.memory?.commit || !params.workspaceId || !params.record) {
    return;
  }
  const input: MemoryCommitInput = {
    schemaVersion: MEMORY_SCHEMA_VERSION,
    content: [
      `Verification leftover from run ${params.record.runId}.`,
      params.summary.slice(0, 1_200),
      `Retry handle: verification/${params.record.recordId}.`,
      `Say "fix the remaining verification errors" to continue.`,
    ].join(" "),
    scope: { kind: "workspace", workspaceId: params.workspaceId },
    tags: ["verification", "retry"],
    privacy: "private",
    source: "verification",
    type: "bug",
  };
  try {
    const result = await runtime.deps.memory.commit(input);
    if (result.status === "committed") {
      params.reasonCodes.push("memory_committed");
    }
  } catch (error) {
    params.warnings.push(
      `Verification memory commit failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

export async function tryLoadVerificationRetry(
  runtime: AgentEngineRuntime,
  params: {
    workspaceId?: string;
    userMessage: string;
    runId: string;
    bus: EventBus;
    warnings: string[];
    logVerbosity: AgentLogVerbosity;
  },
): Promise<VerificationRecord | undefined> {
  if (
    !params.workspaceId ||
    !runtime.deps.verification?.loadLatestRecord ||
    !isVerificationRetryAsk(params.userMessage)
  ) {
    return undefined;
  }
  try {
    return await runtime.deps.verification.loadLatestRecord(params.workspaceId);
  } catch (error) {
    // Distinct from "no prior record" (a resolved undefined): the store
    // read itself failed, so the user's retry ask silently gets no record.
    const message = `Failed to load the prior verification record: ${describeCaughtError(error)}`;
    params.warnings.push(message);
    if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message,
        code: "verification_retry_load_failed",
        at: runtime.isoNow(),
      });
    }
    return undefined;
  }
}
