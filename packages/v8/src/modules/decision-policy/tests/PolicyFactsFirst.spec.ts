import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../pipeline/DecisionPolicyPipeline";
import {
  createDecisionInput,
  createUnderstanding,
} from "./fixtures/decisionFixtureHelpers";

describe("policyFactsFirst routing", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("defaults on: high-confidence question beats mutation-shaped heuristic language", () => {
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        message: "Can you fix the login button? Just explain for now.",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          confidence: 0.92,
          confidenceMargin: 0.4,
        }),
      }),
    );
    expect(["clarify", "diagnose", "repository_answer", "direct_answer"]).toContain(
      decision.route,
    );
    expect(decision.route).not.toBe("execute");
    expect(decision.reasonCodes).toContain("policy_facts_first");
  });

  it("lets ≥70% act/bugfix win over pasted dump diagnose heuristic", () => {
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        message: [
          "TypeError: Cannot read properties of undefined (reading 'map')",
          "    at ProductList (src/ProductList.tsx:42:18)",
          "    at renderWithHooks",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          confidence: 0.9,
          confidenceMargin: 0.3,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
        }),
      }),
    );
    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("policy_facts_first");
    expect(decision.reasonCodes).toContain("policy_llm_authority_write");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).not.toContain("policy_facts_safety_override");
  });

  it("lets soft Officer act+bugfix win on vitest failure pastes below 0.70", () => {
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        message: [
          "Failed Tests 2",
          "FAIL apps/vscode/tests/sidebarSettingsPersistence.test.ts > case",
          "AssertionError: expected false to be true",
          " ❯ apps/vscode/tests/sidebarSettingsPersistence.test.ts:257:31",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          confidence: 0.65,
          confidenceMargin: 0.2,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
          taskAnalysis: {
            taskSize: "medium",
            planningHint: "short",
            clarity: "unclear",
          },
        }),
      }),
    );
    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("policy_llm_authority_write");
    expect(decision.reasonCodes).not.toContain("policy_facts_safety_override");
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
  });

  it("keeps pasted dump diagnose when the ballot is not a trusted write", () => {
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        message: [
          "TypeError: Cannot read properties of undefined (reading 'map')",
          "    at ProductList (src/ProductList.tsx:42:18)",
          "    at renderWithHooks",
        ].join("\n"),
        understanding: createUnderstanding({
          primaryTaskIntent: "diagnose",
          interactionIntent: "question",
          confidence: 0.9,
          confidenceMargin: 0.3,
        }),
      }),
    );
    expect(decision.route).toBe("diagnose");
    expect(decision.reasonCodes).toContain("policy_facts_safety_override");
  });

  it("kill-switch policyFactsFirst:false forces classic path even at high confidence", () => {
    const decision = pipeline.decide({
      ...createDecisionInput({
        mode: "agent",
        message: "Can you fix the login button? Just explain for now.",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          confidence: 0.92,
          confidenceMargin: 0.4,
        }),
      }),
      policyFactsFirst: false,
    });
    expect(decision.reasonCodes).not.toContain("policy_facts_first");
  });
});

describe("turnKind continuation routing", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("tags turn_continuation and executes on steer + trusted write ballot", () => {
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        turnKind: "steer",
        message: "go ahead",
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          confidence: 0.9,
          confidenceMargin: 0.35,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
        }),
      }),
    );
    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("turn_continuation");
    expect(decision.reasonCodes).toContain("policy_facts_first");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.runDisposition).toBe("continue");
  });

  it("does not re-clarify on continuation for soft task-analysis ambiguity alone", () => {
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        turnKind: "follow_up",
        message: "also update the button label",
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          confidence: 0.72,
          confidenceMargin: 0.2,
          needsClarification: false,
          recommendsClarification: false,
          status: "accepted",
          taskAnalysis: {
            clarity: "unclear",
            recommendsTaskClarification: true,
            scope: "single_location",
            complexity: "simple",
            risk: "low",
          },
        }),
      }),
    );
    expect(decision.route).not.toBe("clarify");
    expect(decision.reasonCodes).toContain("turn_continuation");
    expect(decision.runDisposition).toBe("continue");
  });

  it("continuation + plan interaction with write ballot executes (RU plan-approval → act)", () => {
    // Simulates TurnKindIntentPolicy promoting plan → act; if a stale plan
    // interaction somehow remains with a write ballot on continuation, prefer execute.
    const decision = pipeline.decide(
      createDecisionInput({
        mode: "agent",
        turnKind: "continue",
        message: "looks good, proceed",
        understanding: createUnderstanding({
          primaryTaskIntent: "feature",
          interactionIntent: "act",
          confidence: 0.88,
          confidenceMargin: 0.3,
        }),
      }),
    );
    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("turn_continuation");
  });
});
