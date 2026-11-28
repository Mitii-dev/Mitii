import { describe, expect, it } from "vitest";

import {
  buildDiagnosticSummary,
  buildSyntheticPreflightGrant,
  extractMentionedPaths,
  resolvePreflightChangeScope,
  shouldCaptureUnconditionalAgentPreflight,
  uniqueVerificationEvidence,
} from "../../../helpers/preflight";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";
import type { RepoBuildState } from "../../../../modules/verification";

describe("preflight helpers", () => {
  it("builds a read-only synthetic grant", () => {
    const grant = buildSyntheticPreflightGrant("/tmp/ws");
    expect(grant.maximumWorkspaceEffect).toBe("read");
    expect(grant.allowedTools.length).toBeGreaterThan(0);
    expect(grant.pathScopes).toEqual(["."]);
  });

  it("extracts @mentioned paths from query text", () => {
    expect(
      extractMentionedPaths("Please fix @packages/host/src/app.ts now"),
    ).toEqual(["packages/host/src/app.ts"]);
  });

  it("dedupes verification evidence kinds", () => {
    expect(
      uniqueVerificationEvidence(["diagnostics", "diagnostics", "typecheck"]),
    ).toEqual(["diagnostics", "typecheck"]);
  });

  it("builds a diagnostic summary from repo build state", () => {
    const state = {
      diagnostics: [
        {
          path: "src/a.ts",
          severity: "error",
          message: "boom",
          code: "TS2304",
        },
      ],
    } as RepoBuildState;
    const summary = buildDiagnosticSummary(state, "fix src/a.ts");
    expect(summary?.errorCount).toBe(1);
    expect(summary?.inScopeErrorCount).toBe(1);
  });

  it("maps understanding scope to verification changeScope", () => {
    const understanding = {
      taskAnalysis: { scope: "package" },
    } as RequestUnderstandingResult;
    expect(resolvePreflightChangeScope(understanding)).toBe("module");
  });

  it("skips unconditional preflight for status questions", () => {
    expect(
      shouldCaptureUnconditionalAgentPreflight(
        "is headless mode implemented?",
      ),
    ).toBe(false);
  });

  it("captures unconditional preflight for fix requests", () => {
    expect(
      shouldCaptureUnconditionalAgentPreflight(
        "fix the typecheck errors in packages/host",
      ),
    ).toBe(true);
  });
});
