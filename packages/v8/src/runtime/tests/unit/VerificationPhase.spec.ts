import { describe, expect, it } from "vitest";

import {
  commitMemoryOnFinish,
  runVerificationPhase,
  selectVerificationPolicy,
} from "../../helpers/verify";
import { createInlineVerificationRunner } from "../../ports/RuntimeVerificationRunnerPort";
import { StoreManager } from "../../helpers/store";
import { verifyFinishAsync } from "../../flow/steps/11-VerifyFinish";
import { selectRouteBody } from "../../helpers/routes";

describe("S12 verification phase", () => {
  it("selectVerificationPolicy skips when not required", () => {
    const result = selectVerificationPolicy({
      runId: "r1",
      runVerify: false,
      verification: { required: false },
    });
    expect(result.skip).toBe(true);
    expect(result.reasonCodes).toContain("verify_policy_skip_not_required");
  });

  it("selectVerificationPolicy builds request with checks + onFailure", () => {
    const result = selectVerificationPolicy({
      runId: "r2",
      runVerify: true,
      verification: {
        required: true,
        checks: ["diagnostics", "tests"],
        onFailure: "retry",
      },
    });
    expect(result.skip).toBe(false);
    expect(result.request?.checks).toEqual(["diagnostics", "tests"]);
    expect(result.request?.onFailure).toBe("retry");
  });

  it("runVerificationPhase returns repair_requested then repair_capped", async () => {
    let calls = 0;
    const failing = {
      async run() {
        calls += 1;
        return { status: "failed" as const, reasonCodes: ["boom"] };
      },
    };

    const first = await runVerificationPhase({
      runId: "r3",
      runVerify: true,
      verification: {
        required: true,
        checks: ["diagnostics"],
        onFailure: "retry",
      },
      runner: failing,
      repairPass: 0,
    });
    expect(first.returnToLoop).toBe(true);
    expect(first.outcome.status).toBe("repair_requested");

    const capped = await runVerificationPhase({
      runId: "r3",
      runVerify: true,
      verification: {
        required: true,
        checks: ["diagnostics"],
        onFailure: "retry",
      },
      runner: failing,
      repairPass: 2,
    });
    expect(capped.suspendContinue).toBe(true);
    expect(capped.outcome.status).toBe("repair_capped");
    expect(calls).toBe(2);
  });

  it("verifyFinishAsync wires inline runner for execute", async () => {
    const store = StoreManager.create("v-async");
    store.setSlice("decision", {
      route: "execute",
      routeBody: selectRouteBody({
        route: "execute",
        planningDepth: "none",
      }),
      verification: {
        required: true,
        minimumEvidence: ["diagnostics"],
        checks: ["diagnostics"],
        allowUnavailable: true,
        onFailure: "report",
      },
    });
    const result = await verifyFinishAsync(
      {
        store,
        input: { message: "fix a.ts" },
        mode: "agent",
      },
      {
        runId: "v-async",
        runner: createInlineVerificationRunner(),
      },
    );
    expect(result.ranVerify).toBe(true);
    expect(result.outcome?.status).toBe("passed");
    expect(result.reasonCodes).toContain("verification_runner_inline");
  });

  it("commitMemoryOnFinish blocks on repair_capped", () => {
    expect(
      commitMemoryOnFinish({
        runStatus: "completed",
        verificationStatus: "repair_capped",
        hadMutations: true,
        memoryEnabled: true,
      }).shouldCommit,
    ).toBe(false);
    expect(
      commitMemoryOnFinish({
        runStatus: "completed",
        verificationStatus: "passed",
        hadMutations: true,
        memoryEnabled: true,
      }).shouldCommit,
    ).toBe(true);
  });
});
