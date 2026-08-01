import { describe, expect, it } from "vitest";

import { recommendCompletion } from "../RecommendCompletion";
import type { VerificationCheckResult } from "../../contracts";

function check(
  partial: Partial<VerificationCheckResult> &
    Pick<VerificationCheckResult, "checkId" | "kind" | "outcome">,
): VerificationCheckResult {
  return {
    label: partial.label ?? partial.checkId,
    evidenceSource: partial.evidenceSource ?? "test",
    summary: partial.summary ?? `${partial.kind}/${partial.outcome}`,
    ...partial,
  };
}

describe("recommendCompletion", () => {
  it("keeps passed diagnostics+diff as implemented_unverified when tests evidence is undiscoverable", () => {
    // Reproduces billbuddy package.json bumps: diagnostics and diff_review pass,
    // but Decision Policy also asked for tests and the package has no scripts.
    const result = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "diff_review", "tests"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          outcome: "passed",
        }),
        check({
          checkId: "diff_review:workspace",
          kind: "diff_review",
          outcome: "passed",
        }),
      ],
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
    });

    expect(result.status).toBe("implemented_unverified");
    expect(result.reasonCodes).toContain("checks_unavailable");
    expect(result.status).not.toBe("blocked");
    expect(result.status).not.toBe("verification_failed");
  });

  it("does not flip missing evidence to blocked when allowUnavailable is false", () => {
    const result = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["typecheck"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          outcome: "passed",
        }),
      ],
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
    });

    expect(result.status).toBe("implemented_unverified");
  });

  it("returns verification_failed when a check fails", () => {
    const result = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["diagnostics"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          outcome: "failed",
        }),
      ],
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
    });

    expect(result.status).toBe("verification_failed");
    expect(result.reasonCodes).toEqual(["checks_failed"]);
  });

  it("returns verified_success when required evidence is covered", () => {
    const result = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["diagnostics", "diff_review"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          outcome: "passed",
        }),
        check({
          checkId: "diff_review:workspace",
          kind: "diff_review",
          outcome: "passed",
        }),
      ],
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
    });

    expect(result.status).toBe("verified_success");
    expect(result.reasonCodes).toContain("checks_passed");
    expect(result.reasonCodes).toContain("diff_reviewed");
  });

  it("reserves blocked for state unavailable and empty runnable when not allowed", () => {
    expect(
      recommendCompletion({
        verification: {
          required: true,
          minimumEvidence: ["diagnostics"],
          allowUnavailable: false,
        },
        checks: [],
        cancelled: false,
        staleStateRisk: false,
        stateUnavailable: true,
      }).status,
    ).toBe("blocked");

    expect(
      recommendCompletion({
        verification: {
          required: true,
          minimumEvidence: ["tests"],
          allowUnavailable: false,
        },
        checks: [],
        cancelled: false,
        staleStateRisk: false,
        stateUnavailable: false,
      }),
    ).toEqual({
      status: "blocked",
      reasonCodes: ["no_applicable_checks", "grant_insufficient"],
    });
  });
});
