import type {
  ExecutionDecision,
} from "../../../modules/decision-policy";
import {
  buildVerificationGrant,
} from "../../../modules/decision-policy";
import type {
  ModelRequest,
} from "../../../modules/model-gateway";
import { MEMORY_SCHEMA_VERSION } from "../../../modules/memory";
import type { MemoryCommitInput } from "../../../modules/memory";
import type {
  RepositoryStateReference,
} from "../../../modules/repository-state";
import type { WindowPolicy } from "../../../modules/window-budget";
import {
  VERIFICATION_SCHEMA_VERSION,
  buildVerificationRecord,
  buildVerificationUserSummary,
} from "../../../modules/verification";
import type {
  RepoBuildState,
  RepoBuildStateComparison,
  VerificationInput,
  VerificationRecord,
  VerificationRecordStatus,
  VerificationResult,
} from "../../../modules/verification";

import {
  formatVerificationFailureAnswer,
  truncateForEvent,
  decideVerificationGate,
  requiresMutationForExecute,
  resolveVerificationProjects,
  recordBuildStateDeltaEvidence,
  recordStopEvidence,
  recordVerificationEvidence,
} from "../actions";
import type {
  VerificationGateDecision,
} from "../actions";
import type {
  AgentEngineStartInput,
  AgentReasonCode,
  RunEvidence,
} from "../contracts";
import { EventBus } from "../internal/EventBus";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";

import type { AgentEngineRuntime } from "./runtime";
import type {
  VerificationGateOutcome,
} from "./types";

export function isVerificationRetryAsk(message: string): boolean {
  return /\b(fix (those|them|the remaining(?: ones)?|remaining (?:errors|issues|diagnostics)|the (?:verification )?errors)|retry verification|continue (?:the )?verification)\b/i.test(
    message,
  );
}

export function captureBuildStateFromVerificationResult(
  runtime: AgentEngineRuntime,
  params: {
  input: VerificationInput;
  result: VerificationResult;
  phase: "before" | "after";
}): RepoBuildState | undefined {
  return runtime.deps.verification?.buildStateFromResult?.(
    params.input,
    params.result,
    {
      phase: params.phase,
      capturedAt: runtime.isoNow(),
    },
  );
}

export function applyRepoBuildStateComparisonReasonCodes(
  runtime: AgentEngineRuntime,
  params: {
  before?: RepoBuildState;
  after: RepoBuildState;
  reasonCodes: AgentReasonCode[];
}): RepoBuildStateComparison | undefined {
  const comparison = runtime.deps.verification?.compareBuildStates?.({
    before: params.before,
    after: params.after,
  });
  if (!comparison) {
    return undefined;
  }
  if (comparison.reasonCodes.includes("errors_cleared")) {
    params.reasonCodes.push("repo_build_state_errors_cleared");
  }
  if (comparison.reasonCodes.includes("errors_remaining")) {
    params.reasonCodes.push("repo_build_state_errors_remaining");
  }
  if (comparison.reasonCodes.includes("new_errors_introduced")) {
    params.reasonCodes.push("repo_build_state_new_errors");
  }
  return comparison;
}

/**
 * Gate completion on Verification when the decision requires it and a
 * mutation changed files. Commits on accept; leaves rollback to the caller
 * on reject (after an optional repair pass for verification_failed only).
 */
export async function runVerificationGate(
  runtime: AgentEngineRuntime,
  params: {
  runId: string;
  bus: EventBus;
  decision: ExecutionDecision;
  primaryTaskIntent?: string;
  input: AgentEngineStartInput;
  pinnedState: RepositoryStateReference | undefined;
  changedFiles: string[];
  mutationCheckpointIds: string[];
  reasonCodes: AgentReasonCode[];
  warnings: string[];
  repoBuildStateBefore?: RepoBuildState;
  onRepoBuildStateAfter?: (state: RepoBuildState) => void;
  evidence?: RunEvidence;
  windowPolicy: WindowPolicy;
}): Promise<VerificationGateOutcome> {
  const {
    runId,
    bus,
    decision,
    primaryTaskIntent,
    input,
    pinnedState,
    changedFiles,
    mutationCheckpointIds,
    reasonCodes,
    warnings,
    repoBuildStateBefore,
    onRepoBuildStateAfter,
    evidence,
    windowPolicy,
  } = params;

  const missingInfrastructure: string[] = [];
  if (runtime.deps.verification === undefined) {
    missingInfrastructure.push("verification port");
  }
  if (pinnedState === undefined) {
    missingInfrastructure.push("pinned state");
  }
  if (input.workspaceRoot === undefined) {
    missingInfrastructure.push("workspace root");
  }
  const canVerify = missingInfrastructure.length === 0;

  let verificationResult: VerificationResult | undefined;
  let comparison: RepoBuildStateComparison | undefined;
  const shouldRunVerificationChecks =
    changedFiles.length > 0 &&
    canVerify &&
    (decision.verification.required || Boolean(repoBuildStateBefore));
  if (shouldRunVerificationChecks) {
    runtime.emitStage(bus, runId, "verifying", "started");
    const verificationGrant = buildVerificationGrant(decision.toolGrant);
    const projects = resolveVerificationProjects(input);
    verificationResult = await runtime.deps.verification!.verify({
      schemaVersion: VERIFICATION_SCHEMA_VERSION,
      workspaceRoot: input.workspaceRoot!,
      pinnedState: pinnedState!,
      changedFiles,
      projects,
      verification: decision.verification.required
        ? decision.verification
        : {
            ...decision.verification,
            required: true,
            allowUnavailable: true,
          },
      grant: verificationGrant,
      changeScope: "localized",
      baselineDiagnostics: repoBuildStateBefore?.diagnostics,
      stateReadiness: input.repositoryState?.readiness ?? "ready",
      maxChecks: windowPolicy.maxVerificationChecks,
    });
    const afterState = captureBuildStateFromVerificationResult(runtime, {
      input: {
        schemaVersion: VERIFICATION_SCHEMA_VERSION,
        workspaceRoot: input.workspaceRoot!,
        pinnedState: pinnedState!,
        changedFiles,
        projects,
        verification: decision.verification,
        grant: verificationGrant,
        changeScope: "localized",
        stateReadiness: input.repositoryState?.readiness ?? "ready",
        baselineDiagnostics: repoBuildStateBefore?.diagnostics,
      },
      result: verificationResult,
      phase: "after",
    });
    if (afterState) {
      onRepoBuildStateAfter?.(afterState);
      recordBuildStateDeltaEvidence(evidence, {
        before: repoBuildStateBefore,
        after: afterState,
      });
      reasonCodes.push("repo_build_state_after_captured");
      comparison = applyRepoBuildStateComparisonReasonCodes(runtime, {
        before: repoBuildStateBefore,
        after: afterState,
        reasonCodes,
      });
    }
    recordVerificationEvidence(evidence, {
      verification: verificationResult,
      before: repoBuildStateBefore,
    });
    emitVerificationCompleted(runtime, bus, runId, verificationResult);
    runtime.emitEvidenceUpdated(bus, runId, evidence);
    if (afterState) {
      runtime.emitRepoBuildStateCaptured(bus, runId, afterState);
    }
    if (comparison) {
      runtime.emit(bus, {
        type: "verification_comparison",
        runId,
        beforeErrorCount: comparison.beforeErrorCount,
        afterErrorCount: comparison.afterErrorCount,
        clearedErrorCount: comparison.clearedErrorCount,
        newErrorCount: comparison.newErrorCount,
        remainingErrorCount: comparison.remainingErrorCount,
        newWarningCount: comparison.newWarningCount,
        clearedWarningCount: comparison.clearedWarningCount,
        failedCheckIdsAfter: comparison.failedCheckIdsAfter.slice(0, 16),
        reasonCodes: comparison.reasonCodes.slice(0, 16),
        at: runtime.isoNow(),
      });
    }
  }

  const decisionOutcome = decideVerificationGate({
      verificationRequired: decision.verification.required,
      allowUnavailable: decision.verification.allowUnavailable,
      changedFileCount: changedFiles.length,
      mutationRequired: requiresMutationForExecute({
        route: decision.route,
        maximumWorkspaceEffect: decision.toolGrant.maximumWorkspaceEffect,
        primaryTaskIntent,
        reasonCodes: decision.reasonCodes,
      }),
      canVerify,
      missingInfrastructure,
      verification: verificationResult,
      comparison,
    });

  if (decisionOutcome.action === "accept") {
    applyVerificationAcceptSideEffects(runtime, {
      bus,
      runId,
      acceptKind: decisionOutcome.acceptKind,
      verification: verificationResult,
      reasonCodes,
      warnings,
    });
    commitMutations(runtime, mutationCheckpointIds, {
      runId,
      bus,
      warnings,
      logVerbosity: input.logVerbosity,
    });
    recordStopEvidence(evidence, decisionOutcome.acceptKind);
    runtime.emitEvidenceUpdated(bus, runId, evidence);
    return {
      kind: "ok",
      acceptKind: decisionOutcome.acceptKind,
      verification: verificationResult,
      comparison,
    };
  }

  runtime.emitStage(bus, runId, "verifying", "completed", [
    "verification_failed",
  ]);
  return {
    kind: "failed",
    repairable: decisionOutcome.repairable,
    rejectKind: decisionOutcome.rejectKind,
    error: decisionOutcome.error,
    verification: decisionOutcome.verification,
    comparison,
  };
}

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
