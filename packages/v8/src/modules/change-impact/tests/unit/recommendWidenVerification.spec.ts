import { describe, expect, it } from "vitest";

import {
  isGraphConfidenceUnsafe,
  recommendWidenVerification,
} from "../../index";

describe("recommendWidenVerification", () => {
  it("widens when graph confidence is unsafe", () => {
    expect(
      recommendWidenVerification({
        graphConfidenceUnsafe: true,
        reasonCodes: ["graph_confidence_unsafe"],
        status: "partial",
        blastRadius: {
          level: "low",
          fragility: 0.2,
          riskScore: 18,
          riskTier: "safe",
          detail: "safe",
        },
      }),
    ).toBe(true);
    expect(
      isGraphConfidenceUnsafe({
        graphConfidenceUnsafe: true,
        reasonCodes: ["impact_resolved"],
      }),
    ).toBe(true);
  });

  it("widens for critical blast radius even when confidence is fine", () => {
    expect(
      recommendWidenVerification({
        graphConfidenceUnsafe: false,
        reasonCodes: ["impact_resolved"],
        status: "ok",
        blastRadius: {
          level: "high",
          fragility: 0.4,
          riskScore: 88,
          riskTier: "critical",
          detail: "critical",
        },
      }),
    ).toBe(true);
  });

  it("does not widen for a healthy low-risk result", () => {
    expect(
      recommendWidenVerification({
        graphConfidenceUnsafe: false,
        reasonCodes: ["impact_resolved"],
        status: "ok",
        blastRadius: {
          level: "low",
          fragility: 0.1,
          riskScore: 12,
          riskTier: "safe",
          detail: "safe",
        },
      }),
    ).toBe(false);
  });
});
