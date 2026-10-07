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

  it("accepts Index ask after edits: package tsc passed despite vitest+syntax:port flood", () => {
    // Regression: 03-41 thrash — typecheck passed, test+syntax failed with
    // node_modules vitest frames and phantom JSX on changed App.tsx; before=0
    // made ~100 "new" errors and reopened repair/Continue loops.
    const verification = baseVerification({
      status: "verification_failed",
      reasonCodes: ["narrow_scope_selected", "checks_failed"],
      diagnostics: [
        {
          path: "❯ EventEmitter.onMessage ../../node_modules/vitest/dist/chunks/index.B521nVV-.js",
          severity: "error",
          message: "20",
          startLine: 103,
          source: "compiler",
        },
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Cannot use JSX unless the '--jsx' flag is provided.",
          code: "TS17004",
          source: "typescript",
          startLine: 3022,
        },
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Parameter 'path' implicitly has an 'any' type.",
          code: "TS7006",
          source: "typescript",
          startLine: 3025,
        },
      ],
      checks: [
        {
          checkId: "inferred:apps/desktop:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:apps/desktop",
          label: "pnpm typecheck (inferred:apps/desktop)",
          evidenceSource: "manifest",
          outcome: "passed",
          summary: "pnpm typecheck (inferred:apps/desktop) passed (exit 0).",
        },
        {
          checkId: "inferred:apps/desktop:test:test",
          kind: "test",
          projectId: "inferred:apps/desktop",
          label: "pnpm test (inferred:apps/desktop)",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "pnpm test (inferred:apps/desktop) failed (exit 1).",
        },
        {
          checkId: "syntax:port",
          kind: "syntax",
          label: "syntax port",
          evidenceSource: "tool:syntax",
          outcome: "failed",
          summary: "syntax port reported errors",
        },
      ],
    });

    const changedFiles = [
      "apps/desktop/src/renderer/SettingsPanel.tsx",
      "apps/desktop/src/renderer/App.tsx",
    ];

    expect(
      isUserGoalComplete({
        verification,
        comparison: comparison({
          beforeErrorCount: 0,
          afterErrorCount: 200,
          newErrorCount: 102,
          remainingErrorCount: 0,
          failedCheckIdsAfter: [
            "inferred:apps/desktop:test:test",
            "syntax:port",
          ],
          reasonCodes: [
            "errors_remaining",
            "new_errors_introduced",
            "checks_still_failing",
          ],
        }),
        askScopePaths: changedFiles,
        changedFiles,
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
          beforeErrorCount: 0,
          afterErrorCount: 200,
          newErrorCount: 102,
          remainingErrorCount: 0,
          reasonCodes: ["new_errors_introduced", "checks_still_failing"],
        }),
        askScopePaths: changedFiles,
        changedFiles,
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
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

  it("soft-accepts empty-suite workspace-root test noise when build passed", () => {
    // Bench fixtures often run `npm test` before host-injected oracles exist.
    const verification = baseVerification({
      status: "verification_failed",
      reasonCodes: ["narrow_scope_selected", "checks_failed"],
      diagnostics: [],
      checks: [
        {
          checkId: "workspace-root:build:build",
          kind: "build",
          projectId: "workspace-root",
          label: "npm build (workspace-root)",
          evidenceSource: "manifest",
          outcome: "passed",
          summary: "passed",
        },
        {
          checkId: "workspace-root:test:test",
          kind: "test",
          projectId: "workspace-root",
          label: "npm test (workspace-root)",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "npm test (workspace-root) failed (exit 1).",
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
          newErrorCount: 0,
          afterErrorCount: 0,
          failedCheckIdsAfter: ["workspace-root:test:test"],
          reasonCodes: ["checks_still_failing"],
        }),
        changedFiles: ["src/App.jsx"],
        minimumEvidence: ["diagnostics", "diff_review", "tests", "build"],
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("soft-accepts pre-existing workspace-root test failure with no ask-scoped diagnostics", () => {
    // node-express style: ask done, full npm test still fails on unrelated suite.
    const verification = baseVerification({
      status: "verification_failed",
      reasonCodes: ["checks_failed"],
      diagnostics: [],
      checks: [
        {
          checkId: "workspace-root:syntax:node_load",
          kind: "syntax",
          projectId: "workspace-root",
          label: "node --import",
          evidenceSource: "inferred",
          outcome: "passed",
          summary: "passed",
        },
        {
          checkId: "workspace-root:test:test",
          kind: "test",
          projectId: "workspace-root",
          label: "npm test (workspace-root)",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "npm test (workspace-root) failed (exit 1).",
        },
      ],
    });

    expect(
      isUserGoalComplete({
        verification,
        comparison: comparison({
          beforeErrorCount: 0,
          afterErrorCount: 0,
          newErrorCount: 0,
          failedCheckIdsAfter: ["workspace-root:test:test"],
          reasonCodes: ["checks_still_failing", "out_of_scope_residuals_ignored"],
        }),
        changedFiles: ["src/routes/users.js"],
        askScopePaths: ["src/routes/users.js"],
        minimumEvidence: ["diagnostics", "diff_review", "tests"],
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
          beforeErrorCount: 0,
          afterErrorCount: 0,
          newErrorCount: 0,
          failedCheckIdsAfter: ["workspace-root:test:test"],
          reasonCodes: ["checks_still_failing", "out_of_scope_residuals_ignored"],
        }),
        changedFiles: ["src/routes/users.js"],
        askScopePaths: ["src/routes/users.js"],
        minimumEvidence: ["diagnostics", "diff_review", "tests"],
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
    });
  });

  it("soft-accepts pre-existing workspace-root typecheck/build failures when compare has no NEW", () => {
    // saas-api style: fixture has many planted TS errors; ask path is clean.
    const verification = baseVerification({
      status: "verification_failed",
      reasonCodes: ["checks_failed"],
      diagnostics: [
        {
          path: "src/modules/other/unrelated.service.ts",
          severity: "error",
          message: "Property 'x' does not exist.",
          startLine: 10,
        },
      ],
      checks: [
        {
          checkId: "workspace-root:typecheck:build",
          kind: "typecheck",
          projectId: "workspace-root",
          label: "npm build (workspace-root)",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "npm build (workspace-root) failed (exit 2).",
        },
        {
          checkId: "workspace-root:build:build",
          kind: "build",
          projectId: "workspace-root",
          label: "npm build (workspace-root)",
          evidenceSource: "manifest",
          outcome: "failed",
          summary: "npm build (workspace-root) failed (exit 2).",
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
          beforeErrorCount: 158,
          afterErrorCount: 0,
          newErrorCount: 0,
          remainingErrorCount: 0,
          failedCheckIdsAfter: [
            "workspace-root:typecheck:build",
            "workspace-root:build:build",
          ],
          reasonCodes: ["checks_still_failing", "out_of_scope_residuals_ignored"],
        }),
        changedFiles: ["src/common/validation.ts"],
        askScopePaths: ["src/common/validation.ts"],
        minimumEvidence: ["diagnostics", "diff_review", "typecheck", "build"],
      }),
    ).toEqual({
      action: "accept",
      acceptKind: "implemented_unverified",
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
