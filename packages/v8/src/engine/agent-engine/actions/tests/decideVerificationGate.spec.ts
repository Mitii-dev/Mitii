import { describe, expect, it } from "vitest";

import { VERIFICATION_SCHEMA_VERSION } from "../../../../modules/verification";
import type { VerificationResult } from "../../../../modules/verification";

import { decideVerificationGate } from "../decideVerificationGate";

function result(
  status: VerificationResult["status"],
  reasonCodes: VerificationResult["reasonCodes"] = ["checks_passed"],
): VerificationResult {
  return {
    schemaVersion: VERIFICATION_SCHEMA_VERSION,
    status,
    stateToken: "tok",
    affectedProjectIds: [],
    checks: [],
    diagnostics: [],
    diff: {
      reviewed: false,
      staleStateRisk: false,
      summary: "n/a",
      changedPaths: [],
    },
    warnings: [],
    reasonCodes,
    durationMs: 1,
  };
}

describe("decideVerificationGate", () => {
  it("accepts verified_success and implemented_unverified (keeps mutations)", () => {
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification: result("verified_success"),
      }),
    ).toEqual({ action: "accept", acceptKind: "verified_success" });

    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification: result("implemented_unverified", ["checks_unavailable"]),
      }),
    ).toEqual({ action: "accept", acceptKind: "implemented_unverified" });
  });

  it("rejects verification_failed as repairable and blocked as not repairable", () => {
    const failed = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: false,
      changedFileCount: 1,
      canVerify: true,
      verification: result("verification_failed", ["checks_failed"]),
    });
    expect(failed).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
    });

    const blocked = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: false,
      changedFileCount: 1,
      canVerify: true,
      verification: result("blocked", ["state_unavailable"]),
    });
    expect(blocked).toMatchObject({
      action: "reject",
      repairable: false,
      rejectKind: "blocked",
    });
  });

  it("rejects implemented_unverified when diagnostics still contain errors", () => {
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        comparison: {
          beforeErrorCount: 0,
          afterErrorCount: 19,
          clearedErrorCount: 0,
          newErrorCount: 19,
          remainingErrorCount: 0,
          failedCheckIdsBefore: [],
          failedCheckIdsAfter: ["typecheck"],
          reasonCodes: ["new_errors_introduced"],
        },
        verification: result("implemented_unverified", ["checks_unavailable"]),
      }),
    ).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
      error: {
        code: "verification_failed",
        message: expect.stringContaining("19 error(s)"),
      },
    });
  });

  it("accepts legacy soft blocked results when checks only show unavailable evidence", () => {
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification: {
          ...result("blocked", [
            "narrow_scope_selected",
            "no_applicable_checks",
            "checks_unavailable",
          ]),
          checks: [
            {
              checkId: "diagnostics:workspace",
              kind: "diagnostics",
              label: "diagnostics",
              evidenceSource: "tool:read_diagnostics",
              outcome: "passed",
              summary: "Read workspace diagnostics completed.",
            },
            {
              checkId: "diff_review:workspace",
              kind: "diff_review",
              label: "diff review",
              evidenceSource: "tool:read_git_status",
              outcome: "passed",
              summary: "Inspect git status and diff completed.",
            },
          ],
        },
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("keeps hard blocked verification results as rejects", () => {
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: true,
        changedFileCount: 1,
        canVerify: true,
        verification: result("blocked", [
          "no_applicable_checks",
          "grant_insufficient",
        ]),
      }),
    ).toMatchObject({
      action: "reject",
      repairable: false,
      rejectKind: "blocked",
    });
  });

  it("does not treat allowUnavailable as permission to accept failed checks", () => {
    const decision = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: true,
      changedFileCount: 1,
      canVerify: true,
      verification: result("verification_failed", ["checks_failed"]),
    });
    expect(decision.action).toBe("reject");
    expect(decision).toMatchObject({ repairable: true });
  });

  it("skips when verification is not required or no files changed", () => {
    expect(
      decideVerificationGate({
        verificationRequired: false,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: false,
      }),
    ).toEqual({ action: "accept", acceptKind: "skipped_not_required" });

    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 0,
        canVerify: true,
      }),
    ).toEqual({ action: "accept", acceptKind: "skipped_not_required" });
  });

  it("accepts lint-only failures when typecheck and diagnostics are already green", () => {
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        comparison: {
          beforeErrorCount: 109,
          afterErrorCount: 0,
          clearedErrorCount: 109,
          newErrorCount: 0,
          remainingErrorCount: 0,
          failedCheckIdsBefore: ["typecheck"],
          failedCheckIdsAfter: ["lint"],
          reasonCodes: [],
        },
        verification: {
          ...result("verification_failed", ["checks_failed"]),
          checks: [
            {
              checkId: "typecheck:workspace",
              kind: "typecheck",
              label: "typecheck",
              evidenceSource: "tool:typecheck",
              outcome: "passed",
              summary: "Typecheck passed.",
            },
            {
              checkId: "lint:workspace",
              kind: "lint",
              label: "lint",
              evidenceSource: "tool:lint",
              outcome: "failed",
              summary: "Lint reported leftover style issues.",
            },
          ],
        },
      }),
    ).toEqual({ action: "accept", acceptKind: "implemented_unverified" });
  });

  it("rejects zero-edit mutation-required runs", () => {
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 0,
        mutationRequired: true,
        canVerify: true,
      }),
    ).toMatchObject({
      action: "reject",
      repairable: false,
      rejectKind: "no_mutation_performed",
      error: {
        code: "no_mutation_performed",
      },
    });
  });
});
