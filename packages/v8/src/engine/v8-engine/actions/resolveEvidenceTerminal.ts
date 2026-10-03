import type { AgentReasonCode } from "../contracts";
import type { ToolLoopOutcome } from "../pipeline/types";

/**
 * Phase 3 discovery-rail terminals for post-plan evidence / bind exhaustion.
 *
 * Hard invariants (Medium budget numbers unchanged):
 * - Recovery exhausted / miss-not-local → STOP/REPORT (no evidence_clarify Continue)
 * - Continue/resume must not silently reopen discovery after exhaustion
 */

export type EvidenceRailPhase =
  | "binding"
  | "recovering"
  | "exhausted"
  | "ready";

/** After bind+recovery are spent, never offer Continue that reopens discovery. */
export function shouldOfferContinueAfterEvidenceExhaustion(): boolean {
  return false;
}

/**
 * Sticky strip: reason codes from a prior exhaustion must keep discovery
 * tools off across Continue/resume (defense-in-depth if a wall still exists).
 */
export function shouldStripDiscoveryAfterEvidenceExhaustion(params: {
  reasonCodes?: readonly string[];
}): boolean {
  const codes = params.reasonCodes ?? [];
  return (
    codes.includes("evidence_recovery_exhausted_terminal") ||
    codes.includes("evidence_recovery_exhausted")
  );
}

export function isIllegalEvidencePhaseTransition(
  from: EvidenceRailPhase,
  to: EvidenceRailPhase,
): boolean {
  if (from === "exhausted") {
    return to === "binding" || to === "recovering";
  }
  return false;
}

export function buildEvidenceExhaustedTerminalOutcome(params: {
  reason: "recovery_exhausted" | "miss_not_local";
}): Extract<ToolLoopOutcome, { kind: "failed" }> & {
  reasonCodesToPush: AgentReasonCode[];
} {
  const rationale =
    params.reason === "recovery_exhausted"
      ? "Evidence recovery budget exhausted without enough_to_patch. Start a new ask with an explicit file path — do not broaden search."
      : "Bind budget exhausted without identifiable local file evidence. Start a new ask that names the change surface (file path) before more reads or patches.";
  const answer = [
    rationale,
    "Do not keep rediscovering. This run stops here.",
  ].join("\n");
  return {
    kind: "failed",
    answer,
    extraReasons: [],
    error: {
      code: "evidence_exhausted",
      message: answer,
    },
    reasonCodesToPush: [
      "evidence_recovery_exhausted",
      "evidence_recovery_exhausted_terminal",
    ],
  };
}

/** Scalar snapshot for RunEvent warning `data` / host telemetry. */
export function bindBudgetConsumptionSnapshot(params: {
  maxTurns: number;
  maxPaths: number;
  maxNudges: number;
  recoveryTurns: number;
  recoveryPaths: number;
  nudgesUsed: number;
  recoveryUsed: boolean;
  readonlyTurnsOnStep: number;
}): Record<string, string | number | boolean> {
  return {
    maxTurns: params.maxTurns,
    maxPaths: params.maxPaths,
    maxNudges: params.maxNudges,
    recoveryTurns: params.recoveryTurns,
    recoveryPaths: params.recoveryPaths,
    nudgesUsed: params.nudgesUsed,
    recoveryUsed: params.recoveryUsed,
    readonlyTurnsOnStep: params.readonlyTurnsOnStep,
    exhausted: true,
  };
}
