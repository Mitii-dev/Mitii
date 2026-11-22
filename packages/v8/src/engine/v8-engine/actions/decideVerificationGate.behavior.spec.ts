import { describe, expect, it } from "vitest";

import type {
  VerificationCheckResult,
  VerificationResult,
} from "../../../modules/verification";
import { decideVerificationGate } from "./decideVerificationGate";

function check(
  overrides: Partial<VerificationCheckResult> &
    Pick<VerificationCheckResult, "checkId" | "kind" | "outcome">,
): VerificationCheckResult {
  return {
    projectId: "inferred:packages/api",
    label: overrides.checkId,
    evidenceSource: "manifest",
    summary: overrides.outcome,
    ...overrides,
  };
}

function verification(
  status: VerificationResult["status"],
  checks: VerificationCheckResult[],
): VerificationResult {
  return {
    schemaVersion: 1,
    status,
    stateToken: "tok",
    affectedProjectIds: [],
    checks,
    diagnostics: [],
    diff: {
      reviewed: true,
      staleStateRisk: false,
      summary: "ok",
      changedPaths: ["packages/api/src/routes.ts"],
    },
    warnings: [],
    reasonCodes: ["checks_failed"],
    durationMs: 5,
  };
}

const typecheckPassed = check({
  checkId: "inferred:packages/api:typecheck:typecheck",
  kind: "typecheck",
  outcome: "passed",
});

function gate(params: {
  verification: VerificationResult;
  minimumEvidence: string[];
}) {
  return decideVerificationGate({
    verificationRequired: true,
    allowUnavailable: false,
    changedFileCount: 1,
    canVerify: true,
    verification: params.verification,
    changedFiles: ["packages/api/src/routes.ts"],
    minimumEvidence: params.minimumEvidence,
  });
}

describe("decideVerificationGate behavior evidence", () => {
  const failingRouteTest = check({
    checkId: "inferred:packages/api:test:test",
    kind: "test",
    outcome: "failed",
    summary: "GET /api/login expected 200 received 404",
  });

  it("regression: soft-accepts a failing suite after typecheck when behavior is not required", () => {
    const decision = gate({
      verification: verification("verification_failed", [
        typecheckPassed,
        failingRouteTest,
      ]),
      minimumEvidence: ["diagnostics", "diff_review", "tests"],
    });
    expect(decision).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("rejects repairably when behavior is required and the suite failed", () => {
    const decision = gate({
      verification: verification("verification_failed", [
        typecheckPassed,
        failingRouteTest,
      ]),
      minimumEvidence: ["diagnostics", "diff_review", "tests", "behavior"],
    });
    expect(decision).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
    });
  });

  it("rejects an implemented_unverified result that hides a failed behavior suite", () => {
    const decision = gate({
      verification: verification("implemented_unverified", [
        typecheckPassed,
        failingRouteTest,
      ]),
      minimumEvidence: ["behavior"],
    });
    expect(decision).toMatchObject({
      action: "reject",
      repairable: true,
    });
    if (decision.action === "reject") {
      expect(decision.error.message).toMatch(/test\/smoke check/i);
    }
  });

  it("does not block on an empty-suite harness failure", () => {
    const decision = gate({
      verification: verification("verification_failed", [
        typecheckPassed,
        check({
          checkId: "inferred:packages/api:test:test",
          kind: "test",
          outcome: "failed",
          summary: "No test files found, exiting with code 1",
        }),
      ]),
      minimumEvidence: ["tests", "behavior"],
    });
    expect(decision).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("keeps accepting when no test check exists at all (no test infrastructure)", () => {
    const decision = gate({
      verification: verification("implemented_unverified", [typecheckPassed]),
      minimumEvidence: ["behavior"],
    });
    expect(decision).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("ignores workspace-root test failures when a project-local check exists", () => {
    const decision = gate({
      verification: verification("verification_failed", [
        typecheckPassed,
        check({
          checkId: "workspace-root:test:test",
          projectId: "workspace-root",
          kind: "test",
          outcome: "failed",
          summary: "unrelated package failure",
        }),
      ]),
      minimumEvidence: ["behavior"],
    });
    expect(decision).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("counts a workspace-root test failure in a single-package repo", () => {
    const decision = gate({
      verification: verification("verification_failed", [
        check({
          checkId: "workspace-root:typecheck:typecheck",
          projectId: "workspace-root",
          kind: "typecheck",
          outcome: "passed",
        }),
        check({
          checkId: "workspace-root:test:test",
          projectId: "workspace-root",
          kind: "test",
          outcome: "failed",
          summary: "POST /login returned 404",
        }),
      ]),
      minimumEvidence: ["behavior"],
    });
    expect(decision).toMatchObject({ action: "reject", repairable: true });
  });

  it("accepts verified_success with a passed behavior suite", () => {
    const decision = gate({
      verification: verification("verified_success", [
        typecheckPassed,
        check({
          checkId: "inferred:packages/api:test:test",
          kind: "test",
          outcome: "passed",
        }),
      ]),
      minimumEvidence: ["behavior"],
    });
    expect(decision).toEqual({
      action: "accept",
      acceptKind: "verified_success",
    });
  });
});
