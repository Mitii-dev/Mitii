/**
 * Deterministic evidence-gate decision after bind budget is spent.
 * Authorizes PATCH, one targeted RECOVERY, or INSUFFICIENT (clarify/stop).
 * Never authorizes open-world discovery or unlimited continuation.
 */
import {
  decideEvidenceRecovery,
  type EvidenceRecoveryDecision,
} from "./evidenceRecovery";

/** Minimal readiness snapshot for the decision contract. */
export type EvidenceReadinessSnapshot = {
  ready: boolean;
  activeItemId?: string;
  writePaths: string[];
  missingPaths: string[];
};

export type MutateEvidenceDecisionKind =
  | "PATCH_READY"
  | "RECOVERY_REQUIRED"
  | "INSUFFICIENT_EVIDENCE"
  | "EVIDENCE_GATE";

export type MutateEvidenceDecision = {
  kind: MutateEvidenceDecisionKind;
  reason:
    | "paths_loaded"
    | "missing_named_paths"
    | "one_local_dependency"
    | "recovery_exhausted"
    | "miss_not_local"
    | "weak_seed"
    | "no_named_surfaces";
  missingPaths: string[];
  recoveryPaths?: string[];
};

export type EvidenceState = {
  readiness: EvidenceReadinessSnapshot;
  seedTrusted: boolean;
  evidenceGateNudges: number;
  maxEvidenceGateNudges: number;
  recoveryAlreadyUsed: boolean;
  maxRecoveryPaths: number;
};

/**
 * Decide patch / gate / recover / clarify from structured evidence state.
 * Call only after the readonly bind budget for the active step is exhausted.
 */
export function decideMutateEvidenceAction(
  state: EvidenceState,
): MutateEvidenceDecision {
  const { readiness } = state;
  const missingPaths = readiness.missingPaths;

  if (!state.seedTrusted) {
    return {
      kind: "INSUFFICIENT_EVIDENCE",
      reason: "weak_seed",
      missingPaths,
    };
  }

  const enoughToPatch =
    readiness.ready || readiness.missingPaths.length === 0;

  if (enoughToPatch) {
    if (
      readiness.writePaths.length > 0 ||
      readiness.activeItemId ||
      readiness.ready
    ) {
      return {
        kind: "PATCH_READY",
        reason: "paths_loaded",
        missingPaths: [],
      };
    }
    return {
      kind: "INSUFFICIENT_EVIDENCE",
      reason: "no_named_surfaces",
      missingPaths: [],
    };
  }

  if (state.evidenceGateNudges < state.maxEvidenceGateNudges) {
    return {
      kind: "EVIDENCE_GATE",
      reason: "missing_named_paths",
      missingPaths,
    };
  }

  const recovery: EvidenceRecoveryDecision = decideEvidenceRecovery({
    missingPaths,
    recoveryAlreadyUsed: state.recoveryAlreadyUsed,
    maxRecoveryPaths: state.maxRecoveryPaths,
  });

  if (recovery.kind === "recovery") {
    return {
      kind: "RECOVERY_REQUIRED",
      reason: "one_local_dependency",
      missingPaths,
      recoveryPaths: recovery.paths,
    };
  }

  return {
    kind: "INSUFFICIENT_EVIDENCE",
    reason: state.recoveryAlreadyUsed
      ? "recovery_exhausted"
      : "miss_not_local",
    missingPaths,
  };
}
