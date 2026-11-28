/**
 * Lightweight baseline capture at execute pin (S12-BASELINE).
 * Uses host diagnostics / dirty paths only — never launches suites.
 */

import {
  verificationBaselineSnapshotSchema,
  type VerificationBaselineSnapshot,
} from "../../contracts/verify/VerificationBaselineSnapshot";

export interface CaptureVerificationBaselineInput {
  /** Host diagnostic fingerprints (pre-normalized strings). */
  diagnostics?: readonly string[];
  /** Dirty / focused paths in scope. */
  dirtyPaths?: readonly string[];
  focusedFile?: string;
  /** Wall-clock ISO; defaults to now. */
  capturedAt?: string;
}

/**
 * Build a baseline snapshot from cheap host signals.
 * Empty diagnostics still produce a valid empty baseline (source: empty).
 */
export function captureVerificationBaseline(
  input: CaptureVerificationBaselineInput,
): VerificationBaselineSnapshot {
  const scopePaths = [
    ...new Set(
      [
        ...(input.dirtyPaths ?? []),
        ...(input.focusedFile ? [input.focusedFile] : []),
      ]
        .map((p) => p.trim())
        .filter((p) => p.length > 0),
    ),
  ].slice(0, 64);

  const signatures = [
    ...new Set(
      (input.diagnostics ?? [])
        .map((d) => normalizeSignature(d))
        .filter((d) => d.length > 0),
    ),
  ].slice(0, 256);

  const source =
    signatures.length > 0
      ? ("host_diagnostics" as const)
      : ("empty" as const);

  return verificationBaselineSnapshotSchema.parse({
    schemaVersion: 1,
    capturedAt: input.capturedAt ?? new Date().toISOString(),
    source,
    signatures,
    scopePaths,
  });
}

/** Collapse whitespace for stable identity across host formats. */
export function normalizeSignature(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}
