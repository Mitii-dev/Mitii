import type { ModelRequest } from "../../../modules/model-gateway";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { MemoryCommitInput } from "../../../modules/memory";
import {
  buildVerificationRecord,
  buildVerificationUserSummary,
} from "../../../modules/verification";
import { packDiagnosticsForModel } from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationResult,
} from "../../../modules/verification";

import {
  formatVerificationFailureAnswer,
  truncateForEvent,
} from "../actions";
import type { VerificationGateDecision } from "../actions";
import {
  formatVerificationCritiqueWarnings,
  parseVerificationCritique,
  type VerificationCritiqueResult,
} from "../actions/parseVerificationCritique";
import type { AgentReasonCode } from "../contracts";
import { EventBus } from "../internal/EventBus";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";
import type { AgentEngineRuntime } from "./runtime";
import { isVerificationRetryAsk } from "./verificationRetryAsk";

export function applyVerificationAcceptSideEffects(
  runtime: AgentEngineRuntime,
  params: {
  bus: EventBus;
  runId: string;
  acceptKind: Extract<VerificationGateDecision, { action: "accept" }>["acceptKind"];
  verification: VerificationResult | undefined;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): void {
  const { bus, runId, acceptKind, verification, reasonCodes, warnings } =
    params;

  if (acceptKind === "skipped_not_required") {
    return;
  }

  if (acceptKind === "verified_success") {
    runtime.emitStage(bus, runId, "verifying", "completed", [
      "verification_passed",
    ]);
    reasonCodes.push("verification_passed");
    return;
  }

  // implemented_unverified | unavailable_allowed
  runtime.emitStage(bus, runId, "verifying", "completed", [
    "verification_skipped",
  ]);
  reasonCodes.push("verification_skipped");
  if (acceptKind === "implemented_unverified" && verification) {
    warnings.push(
      `Verification incomplete (status: ${verification.status}); implementation kept unverified.`,
    );
  } else if (acceptKind === "unavailable_allowed") {
    warnings.push(
      "Verification was required but unavailable; implementation kept unverified.",
    );
  }
}

export function commitMutations(
  runtime: AgentEngineRuntime,
  
  mutationCheckpointIds: readonly string[],
  context?: {
    runId: string;
    bus: EventBus;
    warnings: string[];
    logVerbosity: AgentLogVerbosity;
  },
): void {
  if (mutationCheckpointIds.length === 0 || !runtime.deps.tools?.commitMutation) {
    return;
  }
  for (const checkpointId of mutationCheckpointIds) {
    try {
      runtime.deps.tools.commitMutation(checkpointId);
    } catch (error) {
      // Best-effort: the mutation already applied to the workspace: a
      // failed checkpoint commit does not undo the edit, it only means the
      // checkpoint bookkeeping for that file may be stale.
      const message = `Failed to commit mutation checkpoint "${checkpointId}": ${describeCaughtError(error)}`;
      context?.warnings.push(message);
      if (context && logVerbosityAtLeast(context.logVerbosity, "standard")) {
        runtime.emit(context.bus, {
          type: "warning",
          runId: context.runId,
          message,
          code: "mutation_commit_failed",
          data: { checkpointId },
          at: runtime.isoNow(),
        });
      }
    }
  }
}

export function emitVerificationCompleted(
  runtime: AgentEngineRuntime,
  
  bus: EventBus,
  runId: string,
  verification: VerificationResult,
): void {
  runtime.emit(bus, {
    type: "verification_completed",
    runId,
    status: verification.status,
    reasonCodes: verification.reasonCodes,
    checks: verification.checks.slice(0, 20).map((check) => ({
      checkId: check.checkId,
      kind: check.kind,
      outcome: check.outcome,
      summary: truncateForEvent(check.summary, 500),
    })),
    diagnostics: verification.diagnostics.slice(0, 20).map((diag) => ({
      path: truncateForEvent(diag.path, 512),
      severity: diag.severity,
      message: truncateForEvent(diag.message, 500),
      startLine: diag.startLine,
      source: diag.source
        ? truncateForEvent(diag.source, 120)
        : undefined,
      code: diag.code ? truncateForEvent(diag.code, 120) : undefined,
    })),
    warnings: verification.warnings
      .slice(0, 20)
      .map((warning) => truncateForEvent(warning, 500)),
    truncated:
      verification.checks.length > 20 || verification.diagnostics.length > 20
        ? true
        : undefined,
    at: runtime.isoNow(),
  });
}

export async function persistVerificationArtifact(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  requestId: string;
  workspaceId?: string;
  bus: EventBus;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  status: VerificationRecordStatus;
  before?: RepoBuildState;
  after?: RepoBuildState;
  comparison?: RepoBuildStateComparison;
  verification?: VerificationResult;
  changedFiles?: readonly string[];
  userSummary?: string;
  previous?: VerificationRecord;
  logVerbosity: AgentLogVerbosity;
}): Promise<VerificationRecord | undefined> {
  if (!params.before && !params.after && !params.verification) {
    return params.previous;
  }
  let record: VerificationRecord;
  try {
    record = buildVerificationRecord({
      runId: params.runId,
      requestId: params.requestId,
      workspaceId: params.workspaceId,
      recordId: params.previous?.recordId ?? params.runId,
      capturedAt: params.previous?.capturedAt,
      status: params.status,
      before: params.before ?? params.previous?.before,
      after: params.after ?? params.previous?.after,
      comparison: params.comparison ?? params.previous?.comparison,
      verification: params.verification ?? params.previous?.verification,
      changedFiles: params.changedFiles ?? params.previous?.changedFiles,
      userSummary: params.userSummary ?? params.previous?.userSummary,
    });
  } catch (error) {
    const message = `Verification record could not be built: ${describeCaughtError(error)}`;
    params.warnings.push(message);
    params.reasonCodes.push("verification_record_build_failed");
    if (logVerbosityAtLeast(params.logVerbosity, "standard")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message,
        code: "verification_record_build_failed",
        at: runtime.isoNow(),
      });
    }
    return params.previous;
  }

  if (runtime.deps.verification?.persistRecord) {
    try {
      await runtime.deps.verification.persistRecord(record);
      params.reasonCodes.push("verification_record_saved");
      runtime.emit(params.bus, {
        type: "verification_record_saved",
        runId: params.runId,
        recordId: record.recordId,
        status: record.status,
        retryAvailable: Boolean(record.retry),
        at: runtime.isoNow(),
      });
    } catch (error) {
      params.warnings.push(
        `Verification record persist failed: ${describeCaughtError(error)}`,
      );
    }
  }

  return record;
}

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
}): Promise<string> {
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
    newErrorCount: params.comparison?.newErrorCount ??
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
}): Promise<
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

/**
 * Optional VTCode-style LLM critique after the evidence gate.
 * Advisory only: never flips accept/reject. Default callers pass
 * `enabled: false`.
 */
export async function tryCritiqueVerification(
  runtime: AgentEngineRuntime,
  params: {
    enabled: boolean;
    bus: EventBus;
    runId: string;
    gateAction: "accept" | "reject";
    verification?: VerificationResult;
    comparison?: RepoBuildStateComparison;
    changedFiles: readonly string[];
    warnings: string[];
    signal: AbortSignal;
    logVerbosity: AgentLogVerbosity;
  },
): Promise<VerificationCritiqueResult | undefined> {
  if (!params.enabled || params.signal.aborted || !params.verification) {
    return undefined;
  }

  try {
    const request: ModelRequest = {
      messages: [
        {
          role: "system",
          content: [
            "You are a read-only verification critic.",
            "Review the evidence pack below. Do not invent diagnostics that are not listed.",
            "Do not call tools. Respond with this exact shape:",
            "",
            "## Verification Result",
            "**Decision:** APPROVE or REJECT",
            "**Issues Found:** (list each issue as `1. [critical|warning|info] …`, or None)",
            "**Reasoning:** brief explanation",
            "",
            "Your Decision is advisory only and cannot override the evidence gate.",
          ].join("\n"),
        },
        {
          role: "user",
          content: buildVerificationCritiqueEvidencePack({
            gateAction: params.gateAction,
            verification: params.verification,
            comparison: params.comparison,
            changedFiles: params.changedFiles,
          }),
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
        if (logVerbosityAtLeast(params.logVerbosity, "verbose")) {
          runtime.emit(params.bus, {
            type: "warning",
            runId: params.runId,
            message: `LLM verification critique skipped (llm_${event.type}).`,
            code: "verification_critique_failed",
            data: { skippedReason: `llm_${event.type}` },
            at: runtime.isoNow(),
          });
        }
        return undefined;
      }
    }

    if (sawToolCall || text.trim().length < 12) {
      if (logVerbosityAtLeast(params.logVerbosity, "verbose")) {
        runtime.emit(params.bus, {
          type: "warning",
          runId: params.runId,
          message: "LLM verification critique skipped (rejected_quality_gate).",
          code: "verification_critique_failed",
          data: { skippedReason: "rejected_quality_gate" },
          at: runtime.isoNow(),
        });
      }
      return undefined;
    }

    const critique = parseVerificationCritique(text);
    if (!critique) {
      return undefined;
    }

    for (const warning of formatVerificationCritiqueWarnings(
      critique,
      params.gateAction,
    )) {
      params.warnings.push(warning);
    }

    runtime.emit(params.bus, {
      type: "verification_critique_ready",
      runId: params.runId,
      decision: critique.decision,
      issueCount: critique.issues.length,
      criticalIssueCount: critique.issues.filter(
        (issue) => issue.severity === "critical",
      ).length,
      gateAction: params.gateAction,
      at: runtime.isoNow(),
    });

    return critique;
  } catch (error) {
    if (logVerbosityAtLeast(params.logVerbosity, "verbose")) {
      runtime.emit(params.bus, {
        type: "warning",
        runId: params.runId,
        message: `LLM verification critique failed: ${describeCaughtError(error)}`,
        code: "verification_critique_failed",
        data: { skippedReason: "llm_error" },
        at: runtime.isoNow(),
      });
    }
    return undefined;
  }
}

function buildVerificationCritiqueEvidencePack(params: {
  gateAction: "accept" | "reject";
  verification: VerificationResult;
  comparison?: RepoBuildStateComparison;
  changedFiles: readonly string[];
}): string {
  const packed = packDiagnosticsForModel({
    diagnostics: params.verification.diagnostics,
    maxTotal: 8,
    maxPerFile: 3,
    errorsOnly: true,
  });
  const checks = params.verification.checks
    .slice(0, 12)
    .map(
      (check) =>
        `- ${check.checkId} [${check.kind}] ${check.outcome}: ${check.summary.slice(0, 160)}`,
    )
    .join("\n");
  const diagnostics = packed.diagnostics
    .map((diagnostic) => {
      const line = diagnostic.startLine ? `:${diagnostic.startLine}` : "";
      return `- ${diagnostic.path}${line} ${diagnostic.message.slice(0, 200)}`;
    })
    .join("\n");

  return [
    `Evidence gate action: ${params.gateAction}`,
    `Verification status: ${params.verification.status}`,
    `Changed files (${params.changedFiles.length}): ${params.changedFiles.slice(0, 20).join(", ") || "(none)"}`,
    params.comparison
      ? `Delta: new=${params.comparison.newErrorCount} remaining=${params.comparison.remainingErrorCount} cleared=${params.comparison.clearedErrorCount}`
      : "Delta: (none)",
    "",
    "Checks:",
    checks || "(none)",
    "",
    "Error diagnostics:",
    diagnostics || "(none)",
  ].join("\n");
}

export async function commitVerificationMemory(
  runtime: AgentEngineRuntime,
  params: {
  record?: VerificationRecord;
  summary: string;
  workspaceId?: string;
  reasonCodes: AgentReasonCode[];
  warnings: string[];
}): Promise<void> {
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
}): Promise<VerificationRecord | undefined> {
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
