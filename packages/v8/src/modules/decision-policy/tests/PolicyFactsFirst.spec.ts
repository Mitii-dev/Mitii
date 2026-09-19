import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../pipeline/DecisionPolicyPipeline";
import {
  createDecisionInput,
  createUnderstanding,
} from "./fixtures/decisionFixtureHelpers";

describe("policyFactsFirst routing", () => {
  const pipeline = new DecisionPolicyPipeline();

  it("prefers high-confidence question over mutation-shaped heuristic language", () => {
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
      policyFactsFirst: true,
    });
    expect(["clarify", "diagnose", "repository_answer", "direct_answer"]).toContain(
      decision.route,
    );
    expect(decision.route).not.toBe("execute");
    expect(decision.reasonCodes).toContain("policy_facts_first");
  });

  it("lets ≥70% act/bugfix win over pasted dump diagnose heuristic", () => {
    const decision = pipeline.decide({
      ...createDecisionInput({
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
      policyFactsFirst: true,
    });
    expect(decision.route).toBe("execute");
    expect(decision.reasonCodes).toContain("policy_facts_first");
    expect(decision.reasonCodes).toContain("policy_llm_authority_write");
    expect(decision.reasonCodes).toContain("mutation_execute");
    expect(decision.reasonCodes).not.toContain("policy_facts_safety_override");
  });

  it("keeps pasted dump diagnose when the ballot is not a trusted write", () => {
    const decision = pipeline.decide({
      ...createDecisionInput({
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
      policyFactsFirst: true,
    });
    expect(decision.route).toBe("diagnose");
    expect(decision.reasonCodes).toContain("policy_facts_safety_override");
  });
});
