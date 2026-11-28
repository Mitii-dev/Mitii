/**
 * Split after-signatures into new regressions vs baseline leftovers (S12-BASELINE).
 */

import type { VerificationBaselineSnapshot } from "../../contracts/verify/VerificationBaselineSnapshot";
import { normalizeSignature } from "./CaptureVerificationBaseline";

export interface CompareAgainstBaselineInput {
  baseline?: VerificationBaselineSnapshot;
  /** Post-change diagnostic / failing-check signatures. */
  afterSignatures?: readonly string[];
  /** When set, only signatures mentioning these paths count as in-scope. */
  changedPaths?: readonly string[];
}

export interface CompareAgainstBaselineResult {
  newRegressions: string[];
  baselineLeftovers: string[];
  /** After signatures outside changedPaths — reported, not blocking. */
  outOfScope: string[];
  reasonCodes: string[];
}

/**
 * New = in after, not in baseline, in touched scope.
 * Leftovers = in after AND baseline (pre-existing).
 * Missing baseline → all in-scope after counts as new (honest; no fake clean).
 */
export function compareAgainstBaseline(
  input: CompareAgainstBaselineInput,
): CompareAgainstBaselineResult {
  const after = [
    ...new Set(
      (input.afterSignatures ?? [])
        .map(normalizeSignature)
        .filter((s) => s.length > 0),
    ),
  ];

  if (after.length === 0) {
    return {
      newRegressions: [],
      baselineLeftovers: [],
      outOfScope: [],
      reasonCodes: ["baseline_compare_clean"],
    };
  }

  const baselineKeys = new Set(input.baseline?.signatures ?? []);
  const scopePaths = [
    ...new Set([
      ...(input.changedPaths ?? []),
      ...(input.baseline?.scopePaths ?? []),
    ]),
  ];
  const scopeApplied = scopePaths.length > 0;

  const inScope: string[] = [];
  const outOfScope: string[] = [];
  for (const sig of after) {
    if (!scopeApplied || signatureTouchesScope(sig, scopePaths)) {
      inScope.push(sig);
    } else {
      outOfScope.push(sig);
    }
  }

  const newRegressions: string[] = [];
  const baselineLeftovers: string[] = [];
  for (const sig of inScope) {
    if (baselineKeys.has(sig)) {
      baselineLeftovers.push(sig);
    } else {
      newRegressions.push(sig);
    }
  }

  const codes = ["baseline_compare_ran"];
  if (!input.baseline || input.baseline.source === "empty") {
    codes.push("baseline_was_empty");
  }
  if (newRegressions.length > 0) {
    codes.push("baseline_new_regressions");
  }
  if (baselineLeftovers.length > 0) {
    codes.push("baseline_leftovers_reported");
  }
  if (outOfScope.length > 0) {
    codes.push("baseline_out_of_scope_ignored");
  }

  return {
    newRegressions,
    baselineLeftovers,
    outOfScope,
    reasonCodes: codes,
  };
}

function signatureTouchesScope(
  signature: string,
  scopePaths: readonly string[],
): boolean {
  const lower = signature.toLowerCase();
  return scopePaths.some((p) => {
    const needle = p.trim().toLowerCase();
    return needle.length > 0 && lower.includes(needle);
  });
}
