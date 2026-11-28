import { describe, expect, it } from "vitest";

import {
  buildVerificationInputFromRequest,
  inferProjectsFromChangedFiles,
} from "../../adapters/compose/BuildVerificationInputFromRequest";

describe("buildVerificationInputFromRequest", () => {
  it("infers package projects from changed files", () => {
    expect(
      inferProjectsFromChangedFiles([
        "packages/checks/src/builtins/http.js",
        "packages/checks/test/http-desugar.test.js",
        "docs/CHECKS.md",
      ]),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          projectId: "packages-checks",
          rootPath: "packages/checks",
        }),
        expect.objectContaining({
          projectId: "root",
          rootPath: ".",
        }),
      ]),
    );
  });

  it("builds a runnable VerificationInput from the request pin", () => {
    const input = buildVerificationInputFromRequest({
      workspaceRoot: "/tmp/ws",
      workspaceId: "ws_1",
      stateToken: "tok_1",
      stateReadiness: "ready",
      request: {
        schemaVersion: 1,
        runId: "run_1",
        required: true,
        checks: ["diagnostics", "tests"],
        allowUnavailable: true,
        onFailure: "report",
        repairPass: 0,
        maxRepairPasses: 2,
        changedPaths: ["packages/checks/src/builtins/http-check.js"],
      },
    });
    expect(input.workspaceRoot).toBe("/tmp/ws");
    expect(input.pinnedState.stateToken).toBe("tok_1");
    expect(input.changedFiles).toEqual([
      "packages/checks/src/builtins/http-check.js",
    ]);
    expect(input.projects[0]?.rootPath).toBe("packages/checks");
    expect(input.verification.minimumEvidence).toEqual(
      expect.arrayContaining(["diagnostics", "tests"]),
    );
    expect(input.grant.commandRules?.[0]?.prefixes).toEqual(
      expect.arrayContaining(["node", "pnpm"]),
    );
  });
});
