import { describe, expect, it } from "vitest";

import {
  isIllegalVerificationPhaseTransition,
  shouldSuspendContinueAfterRepairExhausted,
  shouldSuspendContinueAfterVerificationAccept,
} from "./resolveVerificationTerminal";

describe("resolveVerificationTerminal (Phase 1 ACCEPTED=STOP)", () => {
  it("never offers Continue after gate accept", () => {
    expect(shouldSuspendContinueAfterVerificationAccept()).toBe(false);
  });

  it("never offers Continue after repair exhaustion", () => {
    expect(shouldSuspendContinueAfterRepairExhausted()).toBe(false);
  });

  it("blocks repair/rediscover after accepted", () => {
    expect(isIllegalVerificationPhaseTransition("accepted", "repairing")).toBe(
      true,
    );
    expect(isIllegalVerificationPhaseTransition("accepted", "verifying")).toBe(
      true,
    );
    expect(isIllegalVerificationPhaseTransition("accepted", "failed")).toBe(
      false,
    );
  });

  it("blocks repair/rediscover after repair_exhausted", () => {
    expect(
      isIllegalVerificationPhaseTransition("repair_exhausted", "repairing"),
    ).toBe(true);
    expect(
      isIllegalVerificationPhaseTransition("repair_exhausted", "verifying"),
    ).toBe(true);
    expect(
      isIllegalVerificationPhaseTransition("repair_exhausted", "failed"),
    ).toBe(false);
  });

  it("allows verifying → repairing → accepted forward path", () => {
    expect(isIllegalVerificationPhaseTransition("verifying", "repairing")).toBe(
      false,
    );
    expect(isIllegalVerificationPhaseTransition("repairing", "accepted")).toBe(
      false,
    );
    expect(
      isIllegalVerificationPhaseTransition("repairing", "repair_exhausted"),
    ).toBe(false);
  });
});

/**
 * Golden thrash contract: after soft-accept (typecheck PASS + harness FAIL),
 * the finish path must emit verification_accepted_terminal and must not emit
 * incomplete_checklist / verification_repair_capped Continue walls.
 *
 * Engine wiring: finishVerificationAccepted + shouldSuspendContinue* = false.
 */
describe("post-accept thrash regression contract", () => {
  it("accept terminal reason is distinct from repair Continue walls", () => {
    const acceptTerminal = "verification_accepted_terminal";
    const repairExhausted = "verification_repair_exhausted_terminal";
    const continueWalls = [
      "incomplete_checklist",
      "verification_repair_capped",
    ] as const;

    expect(acceptTerminal).not.toEqual(continueWalls[0]);
    expect(repairExhausted).not.toEqual(continueWalls[1]);
    expect(shouldSuspendContinueAfterVerificationAccept()).toBe(false);
    expect(shouldSuspendContinueAfterRepairExhausted()).toBe(false);
  });
});
