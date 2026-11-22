import { describe, expect, it } from "vitest";

import { runEvidenceSchema } from "../contracts";
import { clampRunEvidence } from "./clampRunEvidence";
import {
  createInitialRunEvidence,
  finalizeRunEvidence,
  recordVerificationEvidence,
} from "./runEvidence";

const longCheck = {
  checkId: `check-${"x".repeat(300)}`,
  kind: "test",
  outcome: "passed",
  summary: "s".repeat(900),
};

describe("clampRunEvidence", () => {
  it("clamps over-long check ids and summaries so the schema accepts them", () => {
    const evidence = createInitialRunEvidence("obj");
    evidence.verification = {
      status: "verified_success",
      checks: [longCheck],
    };
    expect(runEvidenceSchema.safeParse(evidence).success).toBe(false);

    const clamped = clampRunEvidence(evidence);
    const parsed = runEvidenceSchema.parse(clamped);
    expect(parsed.verification?.checks[0]?.checkId.length).toBeLessThanOrEqual(120);
    expect(parsed.verification?.checks[0]?.summary.length).toBeLessThanOrEqual(500);
  });

  it("replaces empty required text and drops empty optional text", () => {
    const evidence = createInitialRunEvidence("obj");
    evidence.verification = {
      status: "passed",
      checks: [{ checkId: "", kind: "k", outcome: "o", summary: "" }],
      stopReason: "",
    };
    const parsed = runEvidenceSchema.parse(clampRunEvidence(evidence));
    expect(parsed.verification?.checks[0]?.checkId).toBeTruthy();
    expect(parsed.verification?.stopReason).toBeUndefined();
  });

  it("finalizeRunEvidence always yields schema-valid evidence", () => {
    const evidence = createInitialRunEvidence("o".repeat(5_000));
    evidence.ledger[0]!.summary = "y".repeat(2_000);
    evidence.finalStopReason = "z".repeat(2_000);
    const finalized = finalizeRunEvidence({
      evidence,
      status: "completed",
      reasonCodes: ["verification_passed"],
    });
    expect(runEvidenceSchema.safeParse(finalized).success).toBe(true);
  });

  it("recordVerificationEvidence truncates at the producer", () => {
    const evidence = createInitialRunEvidence("obj");
    recordVerificationEvidence(evidence, {
      verification: {
        status: "verified_success",
        diagnostics: [],
        checks: [longCheck],
      } as never,
    });
    expect(evidence.verification?.checks[0]?.checkId.length).toBeLessThanOrEqual(120);
    expect(evidence.verification?.checks[0]?.summary.length).toBeLessThanOrEqual(500);
  });
});
