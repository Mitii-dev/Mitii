import { describe, expect, it } from "vitest";

import type { PlanStrategyDecision } from "../../../modules/planning";
import { applyPlanModeDiscoveryContract } from "../planDiscoveryContract";
import { isPlanningFollowUp } from "../planningContext";

const planFromAsk: PlanStrategyDecision = {
  schemaVersion: 1,
  strategy: "plan_from_ask",
  rationale: "test",
  skipDiscover: true,
  useBuildEvidence: false,
};

const clarify: PlanStrategyDecision = {
  schemaVersion: 1,
  strategy: "clarify",
  rationale: "test",
  skipDiscover: true,
  useBuildEvidence: false,
};

describe("isPlanningFollowUp", () => {
  it("treats cold plan prompts as not follow-ups", () => {
    expect(
      isPlanningFollowUp(
        "Can you plan for implementing headless test in this project",
        [],
      ),
    ).toBe(false);
  });

  it("detects plan-the-above when prior turns exist", () => {
    expect(
      isPlanningFollowUp("can you plan the above for implementation", [
        { role: "user", content: "is headless implemented in test cases?" },
        { role: "assistant", content: "No. Edit test/shared/config/testConfig.ts." },
      ]),
    ).toBe(true);
  });
});

describe("applyPlanModeDiscoveryContract", () => {
  it("forces discover_and_plan for cold plan asks that rules classified as clarify", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "auto",
      query: "Can you plan for implementing headless test in this project",
      conversation: [],
      strategy: clarify,
    });
    expect(result.applied).toBe(true);
    expect(result.strategy.strategy).toBe("discover_and_plan");
    expect(result.strategy.skipDiscover).toBe(false);
  });

  it("forces discover_and_plan when known paths would short-circuit cold plan", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "auto",
      query: "Can you plan for implementing headless test in this project",
      conversation: [],
      strategy: planFromAsk,
    });
    expect(result.applied).toBe(true);
    expect(result.strategy.strategy).toBe("discover_and_plan");
  });

  it("keeps plan_from_ask for follow-ups with known surfaces", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "auto",
      query: "can you plan the above for implementation",
      conversation: [
        { role: "user", content: "is headless implemented?" },
        { role: "assistant", content: "Edit test/shared/config/testConfig.ts." },
      ],
      strategy: planFromAsk,
    });
    expect(result.applied).toBe(false);
    expect(result.strategy.strategy).toBe("plan_from_ask");
  });

  it("does not override quick exploration depth", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "quick",
      query: "Can you plan for implementing headless test in this project",
      conversation: [],
      strategy: clarify,
    });
    expect(result.applied).toBe(false);
    expect(result.strategy.strategy).toBe("clarify");
  });

  it("does not override agent mode", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Can you plan for implementing headless test in this project",
      conversation: [],
      strategy: clarify,
    });
    expect(result.applied).toBe(false);
  });

  it("forces discover_and_plan for shaped browser test-runner cold plan asks", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "auto",
      query: "Can you plan for implementing headless test cases",
      conversation: [],
      strategy: planFromAsk,
    });
    expect(result.applied).toBe(true);
    expect(result.strategy.strategy).toBe("discover_and_plan");
    expect(result.rationale).toBe("browser_test_runner");
  });
});

describe("BillBuddy-shaped regression", () => {
  it("matches the 09:50 cold plan prompt contract", () => {
    const rulesStrategy = clarify;
    const contract = applyPlanModeDiscoveryContract({
      mode: "plan",
      query: "Can you plan for implementing headless test in this project",
      conversation: [],
      strategy: rulesStrategy,
    });
    expect(contract.strategy.strategy).toBe("discover_and_plan");
  });
});
