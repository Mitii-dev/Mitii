import { describe, expect, it } from "vitest";

import {
  CODE_INTELLIGENCE_TOOL_IDS,
  DECISION_POLICY_ERROR_CODES,
  DECISION_POLICY_SCHEMA_VERSION,
  DECISION_REASON_CODES,
  DecisionPolicyError,
  DecisionPolicyPipeline,
  EXECUTION_ROUTE,
  EXECUTION_ROUTES,
  MUTATION_TOOL_IDS,
  NETWORK_TOOL_IDS,
  OPT_IN_MUTATION_TOOL_IDS,
  READ_ONLY_TOOL_IDS,
  decisionPolicyInputSchema,
  executionDecisionSchema,
} from "../../index";
import { createInput, createUnderstanding } from "../fixtures/decisionCases";

const pipeline = new DecisionPolicyPipeline();

function decideAgent(message: string) {
  return pipeline.decide(
    createInput({
      mode: "agent",
      message,
      understanding: createUnderstanding({
        primaryTaskIntent: "bugfix",
        interactionIntent: "act",
      }),
    }),
  );
}

describe("DecisionPolicy contract: input", () => {
  it("accepts a valid input and normalizes it through the schema", () => {
    const input = createInput({
      mode: "ask",
      message: "What does parseConfig do?",
      understanding: createUnderstanding({
        primaryTaskIntent: "question",
        interactionIntent: "question",
      }),
    });
    expect(decisionPolicyInputSchema.safeParse(input).success).toBe(true);
  });

  it("rejects a wrong schema version with the invalid_input reason code", () => {
    const input = {
      ...createInput({
        mode: "agent",
        message: "Fix it",
        understanding: createUnderstanding(),
      }),
      schemaVersion: 99,
    };
    try {
      pipeline.decide(input as never);
      expect.unreachable("decide must reject malformed input");
    } catch (error) {
      expect(error).toBeInstanceOf(DecisionPolicyError);
      expect((error as DecisionPolicyError).code).toBe("invalid_input");
    }
  });

  it("rejects a missing envelope instead of guessing a route", () => {
    expect(() => pipeline.decide({ schemaVersion: 1 } as never)).toThrow(
      DecisionPolicyError,
    );
  });

  it("publishes only stable error codes", () => {
    expect([...DECISION_POLICY_ERROR_CODES]).toEqual([
      "invalid_input",
      "incompatible_understanding",
    ]);
  });
});

describe("DecisionPolicy contract: output", () => {
  it("returns a schema-valid decision pinned to the contract version", () => {
    const decision = decideAgent("Null pointer in parseConfig — fix it.");
    expect(executionDecisionSchema.parse(decision)).toEqual(decision);
    expect(decision.schemaVersion).toBe(DECISION_POLICY_SCHEMA_VERSION);
    expect(decision.reasonCodes.length).toBeGreaterThan(0);
    expect(decision.rationale.length).toBeGreaterThan(0);
  });

  it("emits only registered routes and reason codes", () => {
    const messages = [
      "Fix the failing build in src/a.ts",
      "How does the router work?",
      "Make a plan only for the new billing module",
    ];
    for (const message of messages) {
      const decision = decideAgent(message);
      expect(EXECUTION_ROUTES).toContain(decision.route);
      for (const code of decision.reasonCodes) {
        expect(DECISION_REASON_CODES).toContain(code);
      }
    }
  });

  it("routes an explicit mutation ask to execute with a write grant", () => {
    const decision = decideAgent("Fix the null pointer in src/config.ts");
    expect(decision.route).toBe(EXECUTION_ROUTE.EXECUTE);
    expect(decision.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(decision.reasonCodes).toContain("mutation_execute");
  });

  it("seals ask mode read-only regardless of the ballot", () => {
    const decision = pipeline.decide(
      createInput({
        mode: "ask",
        message: "Fix the null pointer in src/config.ts",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
        }),
      }),
    );
    expect(decision.reasonCodes).toContain("mode_ask_readonly");
    expect(decision.toolGrant.maximumWorkspaceEffect).not.toBe("write");
    expect(decision.route).not.toBe(EXECUTION_ROUTE.EXECUTE);
  });

  it("suspends for clarification with a stable disposition", () => {
    const decision = pipeline.decide(
      createInput({
        mode: "agent",
        message: "do it",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          needsClarification: true,
          recommendsClarification: true,
          status: "clarification_required",
          confidence: 0.3,
        }),
      }),
    );
    expect(decision.route).toBe(EXECUTION_ROUTE.CLARIFY);
    expect(decision.runDisposition).toBe("clarification_required");
    expect(decision.reasonCodes).toContain("clarification_material");
    expect(decision.toolGrant.maximumWorkspaceEffect).not.toBe("write");
  });
});

describe("DecisionPolicy contract: route and tool-id ownership", () => {
  it("derives EXECUTION_ROUTES from the single EXECUTION_ROUTE table", () => {
    expect([...EXECUTION_ROUTES].sort()).toEqual(
      Object.values(EXECUTION_ROUTE).sort(),
    );
  });

  it("owns tool id lists as disjoint read-only, mutation and network families", () => {
    const read = new Set<string>(READ_ONLY_TOOL_IDS);
    for (const id of [
      ...MUTATION_TOOL_IDS,
      ...NETWORK_TOOL_IDS,
      ...OPT_IN_MUTATION_TOOL_IDS,
    ]) {
      expect(read.has(id), `${id} must not be read-only`).toBe(false);
    }
    for (const id of CODE_INTELLIGENCE_TOOL_IDS) {
      expect(read.has(id)).toBe(true);
    }
  });
});
