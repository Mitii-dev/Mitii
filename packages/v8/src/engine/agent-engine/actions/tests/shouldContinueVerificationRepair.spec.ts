import { describe, expect, it } from "vitest";

import {
  maxVerificationRepairsForDepth,
  nextStalledRepairCount,
  shouldContinueVerificationRepair,
} from "../shouldContinueVerificationRepair";

describe("shouldContinueVerificationRepair", () => {
  it("allows the first repair when budget remains", () => {
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 0,
        consecutiveStalledRepairs: 0,
        canStartModelCall: true,
      }),
    ).toEqual({ continue: true, reason: "continue" });
  });

  it("caps quick exploration at one repair", () => {
    expect(maxVerificationRepairsForDepth("quick")).toBe(1);
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 1,
        explorationDepth: "quick",
        consecutiveStalledRepairs: 0,
        canStartModelCall: true,
      }),
    ).toEqual({ continue: false, reason: "quick_cap" });
  });

  it("caps auto repairs at the engine default", () => {
    expect(maxVerificationRepairsForDepth("auto")).toBe(1);
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 1,
        explorationDepth: "auto",
        consecutiveStalledRepairs: 0,
        canStartModelCall: true,
      }),
    ).toEqual({ continue: false, reason: "max_attempts" });
  });

  it("honors an explicit window-effort repair cap", () => {
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 0,
        consecutiveStalledRepairs: 0,
        canStartModelCall: true,
        maxAttempts: 0,
      }),
    ).toEqual({ continue: false, reason: "max_attempts" });
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 1,
        consecutiveStalledRepairs: 0,
        canStartModelCall: true,
        maxAttempts: 2,
      }),
    ).toEqual({ continue: true, reason: "continue" });
  });

  it("stops after consecutive non-improving repairs", () => {
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 1,
        consecutiveStalledRepairs: 2,
        canStartModelCall: true,
        maxAttempts: 8,
      }),
    ).toEqual({ continue: false, reason: "stalled" });
  });

  it("stops when the model-call budget is exhausted", () => {
    expect(
      shouldContinueVerificationRepair({
        repairAttempts: 0,
        consecutiveStalledRepairs: 0,
        canStartModelCall: false,
      }),
    ).toEqual({ continue: false, reason: "budget" });
  });

  it("resets stalled count when the error count drops", () => {
    expect(
      nextStalledRepairCount({
        previousAfterErrorCount: 108,
        currentAfterErrorCount: 100,
        consecutiveStalledRepairs: 1,
      }),
    ).toBe(0);
    expect(
      nextStalledRepairCount({
        previousAfterErrorCount: 100,
        currentAfterErrorCount: 100,
        consecutiveStalledRepairs: 0,
      }),
    ).toBe(1);
  });
});
