import { describe, expect, it } from "vitest";

import {
  citedRepoPathsFromPrompt,
  preferConcreteRepoCites,
  preflightDiagnosticsForUserRequest,
  preflightErrorsMatchUserRequest,
  shouldForcePreflightRepairLock,
} from "./index";

describe("userPathPriority", () => {
  it("keeps repair lock off when prompt cites other files than preflight", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 3,
        userPrompt:
          "Fix the failing tests in src/auth/login.spec.ts and src/auth/session.ts",
        diagnosticPaths: [
          "src/ui/legacy-theme.css",
          "src/ui/Button.tsx",
        ],
      }),
    ).toBe(false);
  });

  it("drops fixture src/paths when the paste already cites packages/ apps tests", () => {
    const cited = citedRepoPathsFromPrompt(
      [
        "FAIL packages/host/src/repository-context/createHostRepositoryContext.spec.ts",
        "expected to contain 'src/present.ts'",
        "+ └───present.ts",
        "FAIL packages/v8/tests/architecture/v8-module-boundaries.test.ts",
      ].join("\n"),
    );
    expect(cited).toContain(
      "packages/host/src/repository-context/createhostrepositorycontext.spec.ts",
    );
    expect(cited).toContain(
      "packages/v8/tests/architecture/v8-module-boundaries.test.ts",
    );
    expect(cited).not.toContain("src/present.ts");
    expect(preferConcreteRepoCites(["src/present.ts", "present.ts"])).toEqual([
      "src/present.ts",
      "present.ts",
    ]);
  });

  it("normalizes github/workflows cites to .github/workflows", () => {
    const cited = citedRepoPathsFromPrompt(
      "Update github/workflows/ci.yml to run tests on pull_request",
    );
    expect(cited).toContain(".github/workflows/ci.yml");
    expect(cited).not.toContain("github/workflows/ci.yml");
  });

  it("allows repair lock when prompt names a diagnostic path", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 1,
        userPrompt: "Please fix src/ui/legacy-theme.css type error",
        diagnosticPaths: ["src/ui/legacy-theme.css"],
      }),
    ).toBe(true);
  });

  it("does not force repair lock for ask routes or zero errors", () => {
    expect(
      shouldForcePreflightRepairLock({
        route: "ask",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 2,
        userPrompt: "What is wrong?",
        diagnosticPaths: ["a.ts"],
      }),
    ).toBe(false);
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 0,
        userPrompt: "Fix a.ts",
        diagnosticPaths: [],
      }),
    ).toBe(false);
  });

  it("drops unrelated preflight diagnostics when the user cites other files", () => {
    const kept = preflightDiagnosticsForUserRequest(
      [
        { path: "src/ui/legacy-theme.css", message: "unused" },
        { path: "src/auth/login.spec.ts", message: "fail" },
      ],
      "Fix src/auth/login.spec.ts assertions",
    );
    expect(kept).toEqual([
      { path: "src/auth/login.spec.ts", message: "fail" },
    ]);
  });

  it("drops all diagnostics when the user cites files that never appear in preflight", () => {
    const kept = preflightDiagnosticsForUserRequest(
      [{ path: "src/ui/legacy-theme.css", message: "unused" }],
      "Fix src/auth/login.spec.ts assertions",
    );
    expect(kept).toEqual([]);
  });

  it("treats empty prompt as matching (legacy safe default)", () => {
    expect(
      preflightErrorsMatchUserRequest({
        userPrompt: "",
        diagnosticPaths: ["a.ts"],
      }),
    ).toBe(true);
  });

  it("defers preflight when the ask has no file cites and is not fix-build", () => {
    expect(
      preflightErrorsMatchUserRequest({
        userPrompt:
          "upon clicking Index settings its should redirect properly to semantic tab",
        diagnosticPaths: ["apps/desktop/src/renderer/styles.css"],
      }),
    ).toBe(false);
    expect(
      preflightDiagnosticsForUserRequest(
        [{ path: "apps/desktop/src/renderer/styles.css", message: "padding" }],
        "upon clicking Index settings its should redirect properly to semantic tab",
      ),
    ).toEqual([]);
    expect(
      shouldForcePreflightRepairLock({
        route: "execute",
        maximumWorkspaceEffect: "write",
        preflightErrorCount: 2,
        userPrompt: "upon clicking Index settings redirect to semantic tab",
        diagnosticPaths: ["apps/desktop/src/renderer/styles.css"],
      }),
    ).toBe(false);
  });

  it("invites preflight when the user asks to fix typecheck/build", () => {
    expect(
      preflightErrorsMatchUserRequest({
        userPrompt: "fix all typecheck errors",
        diagnosticPaths: ["src/a.ts"],
      }),
    ).toBe(true);
  });
});
