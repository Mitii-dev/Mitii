import { describe, expect, it } from "vitest";

import {
  captureVerificationBaseline,
  compareAgainstBaseline,
  runVerificationPhase,
} from "../../helpers/verify";
import { createInlineVerificationRunner } from "../../ports/RuntimeVerificationRunnerPort";
import { runEarlyPipeline } from "../../flow/RunEarlyPipeline";

describe("S12-BASELINE", () => {
  it("captureVerificationBaseline pins host diagnostics", () => {
    const snap = captureVerificationBaseline({
      diagnostics: ["src/a.ts: error TS2304: Cannot find name 'x'"],
      dirtyPaths: ["src/a.ts"],
      capturedAt: "2026-01-01T00:00:00.000Z",
    });
    expect(snap.source).toBe("host_diagnostics");
    expect(snap.signatures).toHaveLength(1);
    expect(snap.scopePaths).toContain("src/a.ts");
  });

  it("compareAgainstBaseline splits new vs leftovers", () => {
    const baseline = captureVerificationBaseline({
      diagnostics: ["src/a.ts: old debt"],
      dirtyPaths: ["src/a.ts"],
    });
    const result = compareAgainstBaseline({
      baseline,
      afterSignatures: ["src/a.ts: old debt", "src/a.ts: new break"],
      changedPaths: ["src/a.ts"],
    });
    expect(result.baselineLeftovers).toEqual(["src/a.ts: old debt"]);
    expect(result.newRegressions).toEqual(["src/a.ts: new break"]);
    expect(result.reasonCodes).toContain("baseline_new_regressions");
  });

  it("leftovers alone do not fail a passed runner", async () => {
    const baseline = captureVerificationBaseline({
      diagnostics: ["src/a.ts: old debt"],
      dirtyPaths: ["src/a.ts"],
    });
    const phase = await runVerificationPhase({
      runId: "b1",
      runVerify: true,
      verification: {
        required: true,
        checks: ["diagnostics"],
        onFailure: "report",
      },
      runner: createInlineVerificationRunner(),
      baselineSnapshot: baseline,
      afterSignatures: ["src/a.ts: old debt"],
      changedPaths: ["src/a.ts"],
    });
    expect(phase.outcome.status).toBe("passed");
    expect(phase.outcome.baselineLeftovers).toEqual(["src/a.ts: old debt"]);
    expect(phase.outcome.newRegressions).toEqual([]);
  });

  it("new regressions flip passed runner to failed + repair when onFailure=retry", async () => {
    const baseline = captureVerificationBaseline({
      diagnostics: [],
      dirtyPaths: ["src/a.ts"],
    });
    const phase = await runVerificationPhase({
      runId: "b2",
      runVerify: true,
      verification: {
        required: true,
        checks: ["diagnostics"],
        onFailure: "retry",
      },
      runner: createInlineVerificationRunner(),
      baselineSnapshot: baseline,
      afterSignatures: ["src/a.ts: introduced error"],
      changedPaths: ["src/a.ts"],
      repairPass: 0,
    });
    expect(phase.outcome.status).toBe("repair_requested");
    expect(phase.outcome.newRegressions).toEqual([
      "src/a.ts: introduced error",
    ]);
    expect(phase.returnToLoop).toBe(true);
  });

  it("early pipeline pins verifyBaseline on execute", async () => {
    const result = await runEarlyPipeline({
      start: {
        message:
          "implement a modal with data-testid in packages/v8/src/runtime/helpers/verify please",
        host: {
          diagnostics: ["src/a.ts: pre-existing"],
          dirtyPaths: ["src/a.ts"],
          focusedFile: "src/a.ts",
        },
      },
      mode: "agent",
      runId: "b-decide",
    });
    expect(result.decision.route).toBe("execute");
    expect(result.decision.reasonCodes).toContain("verify_baseline_pinned");
    const baseline = result.store.getSlice<{
      source: string;
      signatures: string[];
    }>("verifyBaseline");
    expect(baseline?.source).toBe("host_diagnostics");
    expect(baseline?.signatures).toContain("src/a.ts: pre-existing");
  });
});
