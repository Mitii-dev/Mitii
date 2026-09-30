import { describe, expect, it } from "vitest";

import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";
import {
  decideVerificationGate,
  isUserGoalComplete,
  packageCompileEvidencePassed,
} from "./decideVerificationGate";

function baseVerification(
  overrides: Partial<VerificationResult> &
    Pick<VerificationResult, "status" | "checks">,
): VerificationResult {
  return {
    schemaVersion: 1,
    stateToken: "tok",
    affectedProjectIds: [],
    diagnostics: [],
    diff: {
      reviewed: true,
      staleStateRisk: false,
      summary: "ok",
      changedPaths: ["packages/host/src/x.ts"],
    },
    warnings: [],
    reasonCodes: ["checks_failed"],
    durationMs: 10,
    ...overrides,
  };
}

function comparison(
  overrides: Partial<RepoBuildStateComparison> = {},
): RepoBuildStateComparison {
  return {
    beforeErrorCount: 0,
    afterErrorCount: 0,
    clearedErrorCount: 0,
    newErrorCount: 0,
    remainingErrorCount: 0,
    failedCheckIdsBefore: [],
    failedCheckIdsAfter: [],
    reasonCodes: [],
    ...overrides,
  };
}

describe("decideVerificationGate / isUserGoalComplete", () => {
  it("accepts when package typecheck passed and only workspace-root checks failed", () => {
    const verification = baseVerification({
      status: "verification_failed",
      checks: [
        {
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          label: "Read workspace diagnostics",
          evidenceSource: "tool:read_diagnostics",
          outcome: "passed",
          summary: "ok",
        },
        {
          checkId: "workspace-root:typecheck:typecheck",
          kind: "typecheck",
          projectId: "workspace-root",
          label: "pnpm typecheck (workspace-root)",
          evidenceSource: "manifest",
          outcome: "timed_out",
          summary: "Timed out",
        },
        {
          checkId: "inferred:packages/host:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:packages/host",
          label: "pnpm typecheck (inferred:packages/host)",
          evidenceSource: "manifest",
          outcome: "passed",
          summary: "passed",
        },
        {
          checkId: "workspace-root:test:test",
          kind: "test",
          projectId: "workspace-root",
          label: "pnpm test (workspace-root)",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
      ],
    });

    expect(packageCompileEvidencePassed(verification)).toBe(true);
    expect(
      isUserGoalComplete({
        verification,
        comparison: comparison({
          afterErrorCount: 4,
          newErrorCount: 4,
          reasonCodes: ["new_errors_introduced", "checks_still_failing"],
          failedCheckIdsAfter: [
            "workspace-root:typecheck:typecheck",
            "workspace-root:test:test",
          ],
        }),
      }),
    ).toBe(true);

    const decision = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: false,
      changedFileCount: 2,
      canVerify: true,
      verification,
      comparison: comparison({
        afterErrorCount: 4,
        newErrorCount: 4,
        reasonCodes: ["new_errors_introduced"],
      }),
    });

    expect(decision).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("accepts desktop UI case: package typecheck passed despite phantom JSX diagnostic flood", () => {
    const verification = baseVerification({
      status: "verification_failed",
      checks: [
        {
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          label: "diagnostics",
          evidenceSource: "tool:read_diagnostics",
          outcome: "passed",
          summary: "ok",
        },
        {
          checkId: "workspace-root:typecheck:typecheck",
          kind: "typecheck",
          projectId: "workspace-root",
          label: "root typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
        {
          checkId: "inferred:apps/desktop:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:apps/desktop",
          label: "desktop typecheck",
          evidenceSource: "manifest",
          outcome: "passed",
          summary: "passed",
        },
      ],
      diagnostics: [
        {
          path: "apps/desktop/src/renderer/chat/MarkdownBody.tsx",
          severity: "error",
          message: "Cannot use JSX unless the '--jsx' flag is provided.",
          code: "TS17004",
          source: "typescript",
        },
      ],
    });

    const decision = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: false,
      changedFileCount: 3,
      canVerify: true,
      verification,
      comparison: comparison({
        beforeErrorCount: 6,
        afterErrorCount: 200,
        newErrorCount: 200,
        clearedErrorCount: 6,
        reasonCodes: ["new_errors_introduced", "checks_still_failing"],
      }),
    });

    expect(decision.action).toBe("accept");
  });

  it("still rejects when package typecheck failed", () => {
    const verification = baseVerification({
      status: "verification_failed",
      checks: [
        {
          checkId: "inferred:packages/host:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:packages/host",
          label: "host typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
        {
          checkId: "workspace-root:typecheck:typecheck",
          kind: "typecheck",
          projectId: "workspace-root",
          label: "root typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
      ],
    });

    const decision = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: false,
      changedFileCount: 1,
      canVerify: true,
      verification,
      comparison: comparison({
        afterErrorCount: 2,
        newErrorCount: 2,
      }),
    });

    expect(decision).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
    });
  });

  it("still rejects when only workspace-root typecheck ran and failed", () => {
    const verification = baseVerification({
      status: "verification_failed",
      checks: [
        {
          checkId: "workspace-root:typecheck:typecheck",
          kind: "typecheck",
          projectId: "workspace-root",
          label: "root typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
      ],
    });

    expect(packageCompileEvidencePassed(verification)).toBe(false);
    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification,
      }).action,
    ).toBe("reject");
  });
});
