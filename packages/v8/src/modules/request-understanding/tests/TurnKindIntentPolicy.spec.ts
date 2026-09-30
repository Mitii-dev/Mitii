import { describe, expect, it } from "vitest";

import { TurnKindIntentPolicy } from "../intent/policy/TurnKindIntentPolicy";
import type { IntentClassification } from "../intent/schema";

const base = (): IntentClassification => ({
  interactionIntent: "act",
  primaryTaskIntent: "bugfix",
  secondaryTaskIntents: [],
  confidence: 0.5,
  alternatives: [],
  needsClarification: true,
  reason: "Ambiguous target.",
});

describe("TurnKindIntentPolicy", () => {
  const policy = new TurnKindIntentPolicy();

  it("leaves new turns unchanged", () => {
    const input = base();
    expect(policy.apply("new", input)).toBe(input);
    expect(policy.apply(undefined, input)).toBe(input);
  });

  it("clears clarification on steer / follow_up", () => {
    for (const turnKind of ["steer", "follow_up", "continue", "recover"] as const) {
      const next = policy.apply(turnKind, base());
      expect(next.needsClarification).toBe(false);
      expect(next.reason).toMatch(/continues an in-flight request/i);
    }
  });
});
