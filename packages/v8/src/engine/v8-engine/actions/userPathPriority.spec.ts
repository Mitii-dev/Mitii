import { describe, expect, it } from "vitest";

import {
  preflightDiagnosticsForUserRequest,
  preflightErrorsMatchUserRequest,
  shouldForcePreflightRepairLock,
} from "./userPathPriority";

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
});
