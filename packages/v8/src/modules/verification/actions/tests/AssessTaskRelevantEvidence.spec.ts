import { describe, expect, it } from "vitest";

import type {
  VerificationCheckResult,
  VerificationDiagnostic,
} from "../../contracts";
import { assessTaskRelevantEvidence } from "../AssessTaskRelevantEvidence";
import { filterActionableDiagnostics } from "../FilterActionableDiagnostics";
import { recommendCompletion } from "../RecommendCompletion";
import { compareRepoBuildStates } from "../CompareRepoBuildStates";
import { captureRepoBuildState } from "../CaptureRepoBuildState";
import type { VerificationInput, VerificationResult } from "../../contracts";

function check(
  partial: Partial<VerificationCheckResult> &
    Pick<VerificationCheckResult, "checkId" | "kind" | "outcome">,
): VerificationCheckResult {
  return {
    label: partial.label ?? partial.checkId,
    evidenceSource: partial.evidenceSource ?? "manifest",
    summary: partial.summary ?? `${partial.kind}/${partial.outcome}`,
    ...partial,
  };
}

describe("filterActionableDiagnostics", () => {
  it("drops vitest/node_modules harness frames and vendor trees", () => {
    const { actionable, omitted } = filterActionableDiagnostics({
      diagnostics: [
        {
          path: "❯ EventEmitter.onMessage ../../node_modules/vitest/dist/chunks/index.js",
          severity: "error",
          message: "20",
          startLine: 103,
          source: "compiler",
        },
        {
          path: "vendor/bundle/ruby/3.2.0/gems/foo.rb",
          severity: "error",
          message: "boom",
          startLine: 1,
        },
        {
          path: ".venv/lib/python3.12/site-packages/pytest/x.py",
          severity: "error",
          message: "boom",
          startLine: 1,
        },
        {
          path: "src/app.py",
          severity: "error",
          message: "NameError: x",
          startLine: 10,
          source: "pytest",
        },
      ],
    });

    expect(omitted.length).toBe(3);
    expect(actionable).toEqual([
      expect.objectContaining({ path: "src/app.py" }),
    ]);
  });

  it("drops phantom secondary diagnostics when compile already passed", () => {
    const { actionable } = filterActionableDiagnostics({
      diagnostics: [
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Cannot use JSX unless the '--jsx' flag is provided.",
          code: "TS17004",
          source: "typescript",
        },
        {
          path: "apps/desktop/src/renderer/App.tsx",
          severity: "error",
          message: "Type '\"index\"' is not assignable",
          code: "TS2345",
          source: "typescript",
        },
      ],
      dropPhantomSecondary: true,
    });

    expect(actionable).toHaveLength(1);
    expect(actionable[0]?.code).toBe("TS2345");
  });
});

describe("assessTaskRelevantEvidence", () => {
  const indexChanged = [
    "apps/desktop/src/renderer/App.tsx",
    "apps/desktop/src/renderer/SettingsPanel.tsx",
  ];

  const indexDiagnostics: VerificationDiagnostic[] = [
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
  ];

  it("accepts Index-ask shape: project typecheck passed + test/syntax harness residuals", () => {
    const assessment = assessTaskRelevantEvidence({
      verification: {
        required: true,
        minimumEvidence: ["typecheck", "diagnostics"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "inferred:apps/desktop:typecheck:typecheck",
          kind: "typecheck",
          projectId: "inferred:apps/desktop",
          outcome: "passed",
        }),
        check({
          checkId: "inferred:apps/desktop:test:test",
          kind: "test",
          projectId: "inferred:apps/desktop",
          outcome: "failed",
        }),
        check({
          checkId: "syntax:port",
          kind: "syntax",
          outcome: "failed",
        }),
      ],
      diagnostics: indexDiagnostics,
      changedFiles: indexChanged,
      askScopePaths: indexChanged,
    });

    expect(assessment.authoritativeCompilePassed).toBe(true);
    expect(assessment.shouldAccept).toBe(true);
    expect(assessment.reasonCodes).toContain("task_relevant_evidence_passed");
    expect(assessment.reasonCodes).toContain("residual_harness_noise");
    expect(assessment.reasonCodes).toContain("residual_phantom_secondary");
  });

  it("accepts rust/go-style project-local build ids (not apps/packages)", () => {
    const assessment = assessTaskRelevantEvidence({
      verification: {
        required: true,
        minimumEvidence: ["build"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "crates/api:build:build",
          kind: "build",
          projectId: "crates/api",
          outcome: "passed",
        }),
        check({
          checkId: "crates/api:test:test",
          kind: "test",
          projectId: "crates/api",
          outcome: "failed",
        }),
      ],
      diagnostics: [
        {
          path: "target/debug/deps/foo-abc.js",
          severity: "error",
          message: "1",
          startLine: 1,
        },
      ],
      changedFiles: ["crates/api/src/lib.rs"],
    });

    expect(assessment.shouldAccept).toBe(true);
    expect(assessment.authoritativeCompilePassed).toBe(true);
  });

  it("rejects when ask-scoped source diagnostics remain after compile pass", () => {
    const assessment = assessTaskRelevantEvidence({
      verification: {
        required: true,
        minimumEvidence: ["typecheck", "tests"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "pkg:typecheck:typecheck",
          kind: "typecheck",
          projectId: "pkg",
          outcome: "passed",
        }),
        check({
          checkId: "pkg:test:test",
          kind: "test",
          projectId: "pkg",
          outcome: "failed",
        }),
      ],
      diagnostics: [
        {
          path: "pkg/src/login_test.py",
          severity: "error",
          message: "AssertionError: expected 200",
          startLine: 42,
          source: "pytest",
        },
      ],
      changedFiles: ["pkg/src/login.py", "pkg/src/login_test.py"],
    });

    expect(assessment.shouldAccept).toBe(false);
    expect(assessment.residualKind).toBe("ask_scoped_defect");
  });

  it("rejects when project-local typecheck failed", () => {
    const assessment = assessTaskRelevantEvidence({
      verification: {
        required: true,
        minimumEvidence: ["typecheck"],
        allowUnavailable: false,
      },
      checks: [
        check({
          checkId: "pkg:typecheck:typecheck",
          kind: "typecheck",
          projectId: "pkg",
          outcome: "failed",
        }),
      ],
      diagnostics: [],
      changedFiles: ["pkg/a.ts"],
    });

    expect(assessment.shouldAccept).toBe(false);
  });
});

describe("recommendCompletion + compare (Index thrash regression)", () => {
  it("soft-accepts and counts zero new actionable errors for harness flood", () => {
    const checks = [
      check({
        checkId: "inferred:apps/desktop:typecheck:typecheck",
        kind: "typecheck",
        projectId: "inferred:apps/desktop",
        outcome: "passed",
      }),
      check({
        checkId: "inferred:apps/desktop:test:test",
        kind: "test",
        projectId: "inferred:apps/desktop",
        outcome: "failed",
      }),
      check({
        checkId: "syntax:port",
        kind: "syntax",
        outcome: "failed",
      }),
    ];
    const diagnostics: VerificationDiagnostic[] = Array.from(
      { length: 50 },
      () => ({
        path: "❯ EventEmitter.onMessage ../../node_modules/vitest/dist/chunks/index.js",
        severity: "error" as const,
        message: "20",
        startLine: 103,
        source: "compiler",
      }),
    );

    const recommendation = recommendCompletion({
      verification: {
        required: true,
        minimumEvidence: ["typecheck", "diagnostics"],
        allowUnavailable: false,
      },
      checks,
      cancelled: false,
      staleStateRisk: false,
      stateUnavailable: false,
      diagnostics,
      changedFiles: [
        "apps/desktop/src/renderer/App.tsx",
        "apps/desktop/src/renderer/SettingsPanel.tsx",
      ],
    });

    expect(recommendation.status).toBe("implemented_unverified");
    expect(recommendation.reasonCodes).toContain(
      "task_relevant_evidence_passed",
    );

    const input = {
      schemaVersion: 1 as const,
      workspaceRoot: "/tmp/ws",
      pinnedState: {
        schemaVersion: 1 as const,
        stateToken: "t",
        workspaceRoot: "/tmp/ws",
        capturedAt: new Date().toISOString(),
      },
      changedFiles: ["apps/desktop/src/renderer/App.tsx"],
      projects: [],
      verification: {
        required: true,
        minimumEvidence: ["typecheck"],
        allowUnavailable: false,
      },
      grant: {
        schemaVersion: 1 as const,
        allowedTools: ["run_readonly_command"],
        maximumWorkspaceEffect: "read" as const,
        pathScopes: ["."],
        approvalMode: "never" as const,
      },
      changeScope: "localized" as const,
    } as unknown as VerificationInput;

    const result = {
      schemaVersion: 1 as const,
      status: recommendation.status,
      stateToken: "t",
      affectedProjectIds: ["inferred:apps/desktop"],
      checks,
      diagnostics,
      allDiagnostics: diagnostics,
      diff: {
        reviewed: true,
        staleStateRisk: false,
        summary: "ok",
        changedPaths: ["apps/desktop/src/renderer/App.tsx"],
      },
      warnings: [],
      reasonCodes: recommendation.reasonCodes,
      durationMs: 1,
    } satisfies VerificationResult;

    const before = captureRepoBuildState({
      phase: "before",
      input,
      result: {
        ...result,
        checks: [
          check({
            checkId: "workspace-root:typecheck:typecheck",
            kind: "typecheck",
            projectId: "workspace-root",
            outcome: "failed",
          }),
        ],
        diagnostics: [],
        allDiagnostics: [],
        reasonCodes: ["checks_failed"],
        status: "verification_failed",
      },
    });
    const after = captureRepoBuildState({
      phase: "after",
      input,
      result,
    });
    const comparison = compareRepoBuildStates({ before, after });

    expect(after.summary.errorCount).toBe(0);
    expect(comparison.newErrorCount).toBe(0);
    expect(comparison.afterErrorCount).toBe(0);
  });
});
