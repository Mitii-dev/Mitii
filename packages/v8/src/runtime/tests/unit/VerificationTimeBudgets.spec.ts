import { describe, expect, it } from "vitest";

import {
  resolveVerificationBudgets,
  runVerificationPhase,
  runWithVerifyWall,
  selectVerificationPolicy,
} from "../../helpers/verify";
import type { RuntimeVerificationRunnerPort } from "../../ports/RuntimeVerificationRunnerPort";

describe("S12-TIME verify budgets", () => {
  it("resolveVerificationBudgets fills defaults", () => {
    expect(resolveVerificationBudgets().verifyWallMs).toBe(120_000);
    expect(resolveVerificationBudgets({ maxChecks: 3 }).maxChecks).toBe(3);
  });

  it("selectVerificationPolicy attaches budgets to request", () => {
    const result = selectVerificationPolicy({
      runId: "t1",
      runVerify: true,
      verification: { required: true, checks: ["diagnostics"] },
      budgets: { verifyWallMs: 5_000, perCheckTimeoutMs: 1_000, maxChecks: 2 },
    });
    expect(result.request?.budgets?.verifyWallMs).toBe(5_000);
    expect(result.request?.budgets?.maxChecks).toBe(2);
  });

  it("runWithVerifyWall returns value before wall", async () => {
    const raced = await runWithVerifyWall({
      wallMs: 5_000,
      work: Promise.resolve("ok"),
    });
    expect(raced.timedOut).toBe(false);
    if (!raced.timedOut) expect(raced.value).toBe("ok");
  });

  it("runWithVerifyWall times out slow work", async () => {
    const raced = await runWithVerifyWall({
      wallMs: 30,
      work: new Promise((resolve) => setTimeout(() => resolve("late"), 500)),
    });
    expect(raced.timedOut).toBe(true);
  });

  it("runVerificationPhase emits progress and times out", async () => {
    const events: string[] = [];
    const slow: RuntimeVerificationRunnerPort = {
      async run() {
        await new Promise((r) => setTimeout(r, 400));
        return { status: "passed", reasonCodes: ["slow"] };
      },
    };
    const phase = await runVerificationPhase({
      runId: "t-wall",
      runVerify: true,
      verification: {
        required: true,
        checks: ["diagnostics"],
        allowUnavailable: true,
        onFailure: "report",
      },
      runner: slow,
      budgets: { verifyWallMs: 40, perCheckTimeoutMs: 20, maxChecks: 2 },
      onProgress: (e) => events.push(e.phase),
    });
    expect(events).toContain("verify_started");
    expect(events).toContain("verify_timed_out");
    expect(phase.outcome.status).toBe("unavailable");
    expect(phase.outcome.reasonCodes).toContain("verification_wall_timed_out");
  });
});
