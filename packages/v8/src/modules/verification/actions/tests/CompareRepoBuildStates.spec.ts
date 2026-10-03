import { describe, expect, it } from "vitest";

import type {
  RepoBuildState,
  VerificationCheckResult,
  VerificationDiagnostic,
} from "../../contracts";
import { compareRepoBuildStates } from "../CompareRepoBuildStates";
import { diagnosticIdentityKey } from "../diagnosticIdentity";

function check(
  overrides: Partial<VerificationCheckResult> &
    Pick<VerificationCheckResult, "checkId" | "kind" | "outcome">,
): VerificationCheckResult {
  return {
    projectId: "inferred:apps/desktop",
    label: overrides.checkId,
    evidenceSource: "manifest",
    summary: `${overrides.checkId} ${overrides.outcome}`,
    ...overrides,
  };
}

function state(params: {
  phase: "before" | "after";
  diagnostics: VerificationDiagnostic[];
  checks: VerificationCheckResult[];
  errorCount?: number;
}): RepoBuildState {
  return {
    schemaVersion: 1,
    capturedAt: "2026-10-02T00:00:00.000Z",
    phase: params.phase,
    scope: {
      workspaceRoot: "/repo",
      folderPrefixes: [],
      projectIds: ["inferred:apps/desktop"],
      changeScope: "localized",
    },
    checks: params.checks,
    diagnostics: params.diagnostics,
    summary: {
      errorCount: params.errorCount ?? params.diagnostics.length,
      warningCount: 0,
      failedCheckIds: params.checks
        .filter((c) => c.outcome === "failed")
        .map((c) => c.checkId),
    },
    reasonCodes: [],
  };
}

describe("compareRepoBuildStates (Phase 2 NEW∩IN_SCOPE∩ACTIONABLE)", () => {
  const typecheckFailed = check({
    checkId: "inferred:apps/desktop:typecheck:typecheck",
    kind: "typecheck",
    outcome: "failed",
  });
  const typecheckPassed = check({
    checkId: "inferred:apps/desktop:typecheck:typecheck",
    kind: "typecheck",
    outcome: "passed",
  });

  it("ignores out-of-scope NEW errors when ask scope is set", () => {
    const before = state({
      phase: "before",
      checks: [typecheckPassed],
      diagnostics: [],
      errorCount: 0,
    });
    const after = state({
      phase: "after",
      checks: [typecheckFailed],
      diagnostics: [
        {
          path: "packages/other/src/unrelated.ts",
          severity: "error",
          message: "Cannot find name 'x'.",
          startLine: 1,
        },
      ],
    });

    const comparison = compareRepoBuildStates({
      before,
      after,
      changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      askScopePaths: ["apps/desktop/src/renderer/App.tsx"],
    });

    expect(comparison.newErrorCount).toBe(0);
    expect(comparison.afterErrorCount).toBe(0);
    expect(comparison.reasonCodes).toContain("out_of_scope_residuals_ignored");
    expect(comparison.reasonCodes).not.toContain("new_errors_introduced");
  });

  it("counts genuine in-scope NEW regressions", () => {
    const before = state({
      phase: "before",
      checks: [typecheckPassed],
      diagnostics: [],
      errorCount: 0,
    });
    const after = state({
      phase: "after",
      checks: [typecheckFailed],
      diagnostics: [
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Type '\"semantic\"' is not assignable",
          startLine: 100,
        },
      ],
    });

    const comparison = compareRepoBuildStates({
      before,
      after,
      changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      askScopePaths: ["apps/desktop/src/renderer/App.tsx"],
    });

    expect(comparison.newErrorCount).toBe(1);
    expect(comparison.reasonCodes).toContain("new_errors_introduced");
    expect(comparison.reasonCodes).not.toContain("out_of_scope_residuals_ignored");
  });

  it("does not treat casing/whitespace variants as new", () => {
    const beforeDiag: VerificationDiagnostic = {
      path: "Apps/Desktop/src/renderer/App.tsx",
      severity: "error",
      message: "Cannot find name  'foo'.",
      startLine: 10,
      startColumn: 1,
      endLine: 10,
      endColumn: 4,
      code: "TS2304",
    };
    const afterDiag: VerificationDiagnostic = {
      path: "apps/desktop/src/renderer/App.tsx",
      severity: "error",
      message: "Cannot find name 'foo'.",
      startLine: 10,
      startColumn: 1,
      endLine: 10,
      endColumn: 4,
      code: "TS2304",
    };
    expect(diagnosticIdentityKey(beforeDiag)).toBe(
      diagnosticIdentityKey(afterDiag),
    );

    const before = state({
      phase: "before",
      checks: [typecheckFailed],
      diagnostics: [beforeDiag],
    });
    const after = state({
      phase: "after",
      checks: [typecheckFailed],
      diagnostics: [afterDiag],
    });
    const comparison = compareRepoBuildStates({
      before,
      after,
      changedFiles: ["apps/desktop/src/renderer/App.tsx"],
    });
    expect(comparison.newErrorCount).toBe(0);
    expect(comparison.remainingErrorCount).toBe(1);
  });
});
