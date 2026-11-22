import { describe, expect, it } from "vitest";

import {
  baseVerification,
  comparison,
} from "../tests/fixtures/verificationGateFixtures";
import {
  decideVerificationGate,
  resolveFailedVerificationTerminalStatus,
  isUserGoalComplete,
  packageCompileEvidencePassed,
} from "./decideVerificationGate";

describe("decideVerificationGate / isUserGoalComplete (rejections)", () => {
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

  it("rejects when project-local typecheck failed even if only harness diagnostics remain", () => {
    // Soft-accept requires authoritative compile evidence. Harness frames alone
    // must not green-exit a failed package typecheck.
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
    ).toBe(false);

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
      }).action,
    ).toBe("reject");
  });

  it("rejects when project-local compile still fails even if compare shows no new errors", () => {
    // Compare-only soft-accept must not hide failed project-local compile
    // (edited package still red).
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
    ).toBe(false);

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
    ).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
    });
  });

  it("rejects failed project checks when scoped compare dropped out-of-scope NEW", () => {
    // Failed selected checks are repairable; out-of-scope diagnostic rows
    // alone must not soft-accept a failed project-local typecheck.
    const verification = baseVerification({
      status: "verification_failed",
      diagnostics: [
        {
          path: "packages/other/src/unrelated.ts",
          severity: "error",
          message: "Cannot find name 'x'.",
          startLine: 1,
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
          summary: "failed from unrelated package noise",
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
        // Scoped compare already dropped out-of-scope NEW.
        comparison: comparison({
          afterErrorCount: 0,
          newErrorCount: 0,
          remainingErrorCount: 0,
          reasonCodes: [
            "out_of_scope_residuals_ignored",
            "checks_still_failing",
          ],
        }),
        askScopePaths: ["apps/desktop/src/renderer/App.tsx"],
        changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      }),
    ).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
    });
  });

  it("rejects repairable when required tests fail with parseable assertion diagnostics", () => {
    const changedFiles = ["src/App.jsx"];
    const verification = baseVerification({
      status: "verification_failed",
      reasonCodes: ["narrow_scope_selected", "checks_failed"],
      diagnostics: [
        {
          path: "src/App.jsx",
          severity: "error",
          message: "Unable to find an element by: [data-testid=\"cookie-banner\"]",
          startLine: 1,
          source: "vitest",
        },
      ],
      checks: [
        {
          checkId: "pkg:build:build",
          kind: "build",
          projectId: "pkg",
          label: "npm build",
          evidenceSource: "manifest",
          outcome: "passed",
          summary: "passed",
        },
        {
          checkId: "pkg:test:test",
          kind: "test",
          projectId: "pkg",
          label: "npm test",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "failed",
        },
      ],
    });

    expect(
      isUserGoalComplete({
        verification,
        comparison: comparison({
          newErrorCount: 0,
          afterErrorCount: 0,
          failedCheckIdsAfter: ["pkg:test:test"],
          reasonCodes: ["checks_still_failing"],
        }),
        changedFiles,
        askScopePaths: changedFiles,
        minimumEvidence: ["diagnostics", "diff_review", "tests", "build"],
      }),
    ).toBe(false);

    expect(
      decideVerificationGate({
        verificationRequired: true,
        allowUnavailable: false,
        changedFileCount: 1,
        canVerify: true,
        verification,
        comparison: comparison({
          newErrorCount: 0,
          afterErrorCount: 0,
          failedCheckIdsAfter: ["pkg:test:test"],
          reasonCodes: ["checks_still_failing"],
        }),
        changedFiles,
        askScopePaths: changedFiles,
        minimumEvidence: ["diagnostics", "diff_review", "tests", "build"],
      }),
    ).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
    });
  });

  it("rejects repairable on genuine in-scope NEW regression", () => {
    const verification = baseVerification({
      status: "verification_failed",
      diagnostics: [
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Type '\"semantic\"' is not assignable",
          startLine: 100,
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

    const decision = decideVerificationGate({
      verificationRequired: true,
      allowUnavailable: false,
      changedFileCount: 1,
      canVerify: true,
      verification,
      comparison: comparison({
        afterErrorCount: 1,
        newErrorCount: 1,
        reasonCodes: ["new_errors_introduced", "checks_still_failing"],
      }),
      askScopePaths: ["apps/desktop/src/renderer/App.tsx"],
      changedFiles: ["apps/desktop/src/renderer/App.tsx"],
    });

    expect(decision).toMatchObject({
      action: "reject",
      repairable: true,
      rejectKind: "verification_failed",
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
