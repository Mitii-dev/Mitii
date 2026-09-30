import { describe, expect, it } from "vitest";

import {
  TurnKindIntentPolicy,
  isContinuationTurnKind,
} from "../intent/policy/TurnKindIntentPolicy";
import { IntentRouter } from "../intent/IntentRouter";
import type { IntentClassification } from "../intent/schema";
import type { LlmPort } from "../../model-gateway";
import type { SuperIntentResult } from "../intent/types";

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
      expect(isContinuationTurnKind(turnKind)).toBe(true);
    }
  });

  it("promotes plan→act on short approval phrases", () => {
    const planBallot: IntentClassification = {
      ...base(),
      interactionIntent: "plan",
      needsClarification: false,
      reason: "Plan requested.",
    };
    const next = policy.apply("steer", planBallot, {
      userMessage: "go ahead",
    });
    expect(next.interactionIntent).toBe("act");
    expect(next.reason).toMatch(/approved the prior plan/i);
  });
});

describe("IntentRouter applyTurnKind status sync", () => {
  it("accepts continuation turns that deferred clarification", async () => {
    const llmPort = {
      capabilities: {
        contextWindowTokens: 128_000,
        maximumOutputTokens: 4096,
      },
      complete: async function* () {
        yield {
          type: "failed",
          error: { code: "test", message: "unused" },
        };
      },
    } as unknown as LlmPort;

    const router = new IntentRouter(llmPort, {
      ruleClassifier: {
        classifyMessage: () => null,
      },
      llmClassifier: {
        classify: async () => ({
          interactionIntent: "act",
          primaryTaskIntent: "bugfix",
          secondaryTaskIntents: [],
          confidence: 0.45,
          alternatives: [
            { intent: "feature", confidence: 0.4 },
            { intent: "refactor", confidence: 0.35 },
          ],
          needsClarification: true,
          reason: "Ambiguous target on first turn.",
        }),
      },
    });

    const first = await router.classify({
      mode: "agent",
      userMessage: "fix that thing",
      turnKind: "new",
    });
    expect(first.status).toBe("clarification_required");
    expect(first.recommendsClarification).toBe(true);

    const steered = await router.classify({
      mode: "agent",
      userMessage: "fix LoginForm.tsx loading state",
      turnKind: "steer",
    });
    expect(steered.status).toBe("accepted");
    expect(steered.recommendsClarification).toBe(false);
    expect(steered.classification.needsClarification).toBe(false);
    expect(steered.clarification).toBeUndefined();
  });
});

/** Compile-time guard that SuperIntentResult shape is imported for clarity. */
void (0 as unknown as SuperIntentResult);
