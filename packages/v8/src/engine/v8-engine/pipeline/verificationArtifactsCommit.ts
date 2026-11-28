/**
 * Mutation commit + verification accept/complete side effects.
 */
import type { VerificationResult } from "../../../modules/verification";

import { truncateForEvent } from "../actions";
import type { VerificationGateDecision } from "../actions";
import type { AgentReasonCode } from "../contracts";
import type { EventBus } from "../internal/EventBus";
import {
  logVerbosityAtLeast,
  type AgentLogVerbosity,
} from "../internal/logVerbosity";
import { describeCaughtError } from "../internal/describeCaughtError";
import type { AgentEngineRuntime } from "./runtime";

export function applyVerificationAcceptSideEffects(
  runtime: AgentEngineRuntime,
  params: {
    bus: EventBus;
    runId: string;
    acceptKind: Extract<
      VerificationGateDecision,
      { action: "accept" }
    >["acceptKind"];
    verification: VerificationResult | undefined;
    reasonCodes: AgentReasonCode[];
    warnings: string[];
  },
): void {
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
