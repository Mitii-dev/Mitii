import { describe, expect, it } from "vitest";

import {
  bindBudgetConsumptionSnapshot,
  buildEvidenceExhaustedTerminalOutcome,
  isIllegalEvidencePhaseTransition,
  shouldOfferContinueAfterEvidenceExhaustion,
  shouldStripDiscoveryAfterEvidenceExhaustion,
} from "./resolveEvidenceTerminal";

describe("resolveEvidenceTerminal (Phase 3 discovery rail)", () => {
  it("never offers Continue after evidence exhaustion", () => {
    expect(shouldOfferContinueAfterEvidenceExhaustion()).toBe(false);
  });

  it("strips discovery sticky after exhaustion reason codes", () => {
    expect(
      shouldStripDiscoveryAfterEvidenceExhaustion({
        reasonCodes: ["evidence_recovery_exhausted"],
      }),
    ).toBe(true);
    expect(
      shouldStripDiscoveryAfterEvidenceExhaustion({
        reasonCodes: ["evidence_recovery_exhausted_terminal"],
      }),
    ).toBe(true);
    expect(
      shouldStripDiscoveryAfterEvidenceExhaustion({
        reasonCodes: ["step_mutate_lock_armed"],
      }),
    ).toBe(false);
  });

  it("blocks binding/recovering after exhausted", () => {
    expect(isIllegalEvidencePhaseTransition("exhausted", "binding")).toBe(
      true,
    );
    expect(isIllegalEvidencePhaseTransition("exhausted", "recovering")).toBe(
      true,
    );
    expect(isIllegalEvidencePhaseTransition("recovering", "exhausted")).toBe(
      false,
    );
  });

  it("builds failed terminal without Continue wall", () => {
    const outcome = buildEvidenceExhaustedTerminalOutcome({
      reason: "recovery_exhausted",
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.error.code).toBe("evidence_exhausted");
    expect(outcome.reasonCodesToPush).toContain(
      "evidence_recovery_exhausted_terminal",
    );
    expect(outcome.answer).toMatch(/stops here/i);
    expect(outcome.answer).not.toMatch(/Prefer Continue/i);
  });

  it("emits bind-budget consumption snapshot scalars", () => {
    const snapshot = bindBudgetConsumptionSnapshot({
      maxTurns: 4,
      maxPaths: 8,
      maxNudges: 3,
      recoveryTurns: 2,
      recoveryPaths: 4,
      nudgesUsed: 3,
      recoveryUsed: true,
      readonlyTurnsOnStep: 4,
    });
    expect(snapshot).toMatchObject({
      maxTurns: 4,
      maxPaths: 8,
      maxNudges: 3,
      nudgesUsed: 3,
      recoveryUsed: true,
      exhausted: true,
    });
  });
});
