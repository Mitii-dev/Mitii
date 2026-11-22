import { describe, expect, it } from "vitest";

import {
  baseVerification,
  comparison,
} from "../tests/fixtures/verificationGateFixtures";
import {
  decideVerificationGate,
  isUserGoalComplete,
  packageCompileEvidencePassed,
} from "./decideVerificationGate";

describe("decideVerificationGate / isUserGoalComplete (acceptance)", () => {
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
});
