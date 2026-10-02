import { describe, expect, it } from "vitest";

import type {
  RepoBuildStateComparison,
  VerificationResult,
} from "../../../modules/verification";
import {
  decideVerificationGate,
  resolveFailedVerificationTerminalStatus,
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

  it("rejects mutation-required execute with zero file changes", () => {
    const decision = decideVerificationGate({
      verificationRequired: false,
      allowUnavailable: true,
      changedFileCount: 0,
      mutationRequired: true,
      canVerify: false,
    });
    expect(decision).toEqual({
      action: "reject",
      repairable: false,
      rejectKind: "no_mutation_performed",
      error: {
        code: "no_mutation_performed",
        message:
          "The task required workspace edits, but the model completed without changing any files.",
      },
    });
  });

  it("accepts when package checks fail but ask/changed paths have no diagnostics", () => {
    const verification = baseVerification({
      status: "verification_failed",
      diagnostics: [
        {
          path: "node_modules/vitest/dist/chunks/index.js",
          severity: "error",
          message: "EventEmitter.onMessage",
          startLine: 103,
        },
      ],
      checks: [
        {
          checkId: "inferred:apps/desktop:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:apps/desktop",
          label: "desktop typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
        {
          checkId: "inferred:apps/desktop:test:test",
          kind: "test",
          projectId: "inferred:apps/desktop",
          label: "desktop test",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
        {
          checkId: "diagnostics:workspace",
          kind: "diagnostics",
          label: "diagnostics",
          evidenceSource: "tool:read_diagnostics",
          outcome: "passed",
          summary: "ok",
        },
      ],
    });

    expect(
      isUserGoalComplete({
        verification,
        comparison: comparison({
          afterErrorCount: 200,
          newErrorCount: 99,
        }),
        askScopePaths: [
          "apps/desktop/src/renderer/App.tsx",
          "apps/desktop/src/shared/settings.ts",
        ],
        changedFiles: [
          "apps/desktop/src/renderer/App.tsx",
          "apps/desktop/src/shared/settings.ts",
        ],
      }),
    ).toBe(true);

    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 2,
        canVerify: true,
        verification,
        comparison: comparison({
          afterErrorCount: 200,
          newErrorCount: 99,
        }),
        askScopePaths: [
          "apps/desktop/src/renderer/App.tsx",
          "apps/desktop/src/shared/settings.ts",
        ],
        changedFiles: [
          "apps/desktop/src/renderer/App.tsx",
          "apps/desktop/src/shared/settings.ts",
        ],
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("accepts when comparison shows only remaining pre-existing errors (no new)", () => {
    const verification = baseVerification({
      status: "verification_failed",
      diagnostics: [],
      checks: [
        {
          checkId: "inferred:apps/desktop:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:apps/desktop",
          label: "desktop typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "pre-existing failures",
        },
      ],
    });

    expect(
      isUserGoalComplete({
        verification,
        comparison: comparison({
          beforeErrorCount: 3,
          afterErrorCount: 3,
          newErrorCount: 0,
          remainingErrorCount: 3,
        }),
        changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      }),
    ).toBe(true);

    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification,
        comparison: comparison({
          beforeErrorCount: 3,
          afterErrorCount: 3,
          newErrorCount: 0,
          remainingErrorCount: 3,
        }),
        changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("still rejects when ask-scoped diagnostics remain on changed files", () => {
    const verification = baseVerification({
      status: "verification_failed",
      diagnostics: [
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Type '\"semantic\"' is not assignable",
          startLine: 3521,
        },
      ],
      checks: [
        {
          checkId: "inferred:apps/desktop:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:apps/desktop",
          label: "desktop typecheck",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
      ],
    });

    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification,
        comparison: comparison({
          afterErrorCount: 1,
          newErrorCount: 1,
        }),
        askScopePaths: ["apps/desktop/src/renderer/App.tsx"],
        changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      }).action,
    ).toBe("reject");
  });
});

describe("resolveFailedVerificationTerminalStatus", () => {
  it("fails when mutation was required but never performed", () => {
    expect(
      resolveFailedVerificationTerminalStatus({
        changedFileCount: 0,
        rejectKind: "no_mutation_performed",
      }),
    ).toBe("failed");
  });

  it("fails when edits were kept after a failed verification", () => {
    expect(
      resolveFailedVerificationTerminalStatus({
        changedFileCount: 2,
        rejectKind: "verification_failed",
      }),
    ).toBe("failed");
  });

  it("does not invent success for no_mutation via the zero-file branch", () => {
    // Regression: previously `changedFileCount === 0` mapped to completed,
    // which turned gate reject(no_mutation_performed) into a false green exit.
    expect(
      resolveFailedVerificationTerminalStatus({
        changedFileCount: 0,
        rejectKind: "no_mutation_performed",
      }),
    ).not.toBe("completed");
  });
});
