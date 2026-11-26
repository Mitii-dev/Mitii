import { describe, expect, it } from "vitest";

import type { PlanStrategyDecision } from "../../../modules/planning";
import {
  applyPlanModeDiscoveryContract,
  isAgentWidePlanningScope,
} from "../../helpers/plan-discovery/PlanDiscoveryContract";
import { isPlanningFollowUp } from "../../helpers/plan-discovery/IsPlanningFollowUp";

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

  it("forces discover_and_plan after a Plan A/B/C scope choice on follow-up", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "auto",
      query:
        "How I can improve the test cases?\n\nClarification: C) Runner / architecture changes — Redesign grading DSL",
      conversation: [
        { role: "user", content: "How I can improve the test cases?" },
        {
          role: "assistant",
          content: "Before I lock a plan, choose A/B/C scope.",
        },
        {
          role: "user",
          content: "C) Runner / architecture changes",
        },
      ],
      strategy: clarify,
    });
    expect(result.applied).toBe(true);
    expect(result.rationale).toBe("plan_scope_choice_honored");
    expect(result.strategy.strategy).toBe("discover_and_plan");
  });

  it("forces discover_and_plan after Agent A/B/C scope choice on a medium task", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query:
        "Improve the test corpus\n\nClarification: B) Corpus-wide quality bar — Raise the bar across weak cases",
      conversation: [
        { role: "user", content: "Improve the test corpus" },
        { role: "assistant", content: "Choose A/B/C before I execute." },
        { role: "user", content: "B) Corpus-wide quality bar" },
      ],
      strategy: clarify,
      planningDepth: "internal",
      taskSize: "medium",
    });
    expect(result.applied).toBe(true);
    expect(result.rationale).toBe("plan_scope_choice_honored");
    expect(result.strategy.strategy).toBe("discover_and_plan");
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

  it("does not override small Agent tasks without plan depth", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Can you plan for implementing headless test in this project",
      conversation: [],
      strategy: clarify,
    });
    expect(result.applied).toBe(false);
  });

  it("forces discover_and_plan for Agent visible big tasks", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Coordinate a multi-package release checklist update",
      conversation: [],
      strategy: planFromAsk,
      planningDepth: "visible",
    });
    expect(result.applied).toBe(true);
    expect(result.strategy.strategy).toBe("discover_and_plan");
    expect(result.strategy.skipDiscover).toBe(false);
    expect(["agent_big_task", result.rationale]).toContain(result.rationale);
  });

  it("forces discover_and_plan for Agent wide-internal tasks", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Refactor the payments package",
      conversation: [],
      strategy: clarify,
      planningDepth: "internal",
      agentWideScope: true,
    });
    expect(result.applied).toBe(true);
    expect(result.strategy.strategy).toBe("discover_and_plan");
  });

  it("forces discover_and_plan for Agent medium taskSize on internal depth", () => {
    const result = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Add caching around the product list service and update its unit tests",
      conversation: [],
      strategy: planFromAsk,
      planningDepth: "internal",
      agentWideScope: false,
      taskSize: "medium",
    });
    expect(result.applied).toBe(true);
    expect(result.strategy.strategy).toBe("discover_and_plan");
    expect(result.rationale).toBe("agent_medium_task");
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

describe("isAgentWidePlanningScope", () => {
  it("matches package/complex/recommendsPlanning", () => {
    expect(isAgentWidePlanningScope({ scope: "package" })).toBe(true);
    expect(isAgentWidePlanningScope({ complexity: "complex" })).toBe(true);
    expect(isAgentWidePlanningScope({ recommendsPlanning: true })).toBe(true);
    expect(
      isAgentWidePlanningScope({ scope: "single_location", complexity: "simple" }),
    ).toBe(false);
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

  it("overrides follow_evidence for Plan cold POM architecture asks", () => {
    const followEvidence: PlanStrategyDecision = {
      schemaVersion: 1,
      strategy: "follow_evidence",
      rationale: "incidental diagnostics",
      skipDiscover: true,
      useBuildEvidence: true,
    };
    const contract = applyPlanModeDiscoveryContract({
      mode: "plan",
      explorationDepth: "auto",
      query:
        "Plan a cross-platform Page Object Model refactor for test/ — shared base, platform pages, specs",
      conversation: [],
      strategy: followEvidence,
    });
    expect(contract.applied).toBe(true);
    expect(contract.strategy.strategy).toBe("discover_and_plan");
    expect(contract.strategy.skipDiscover).toBe(false);
  });

  it("overrides follow_evidence for Agent visible architecture asks", () => {
    const followEvidence: PlanStrategyDecision = {
      schemaVersion: 1,
      strategy: "follow_evidence",
      rationale: "incidental diagnostics",
      skipDiscover: true,
      useBuildEvidence: true,
    };
    const contract = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Refactor the architecture of the test/ Page Object Model",
      conversation: [],
      strategy: followEvidence,
      planningDepth: "visible",
      agentWideScope: true,
    });
    expect(contract.applied).toBe(true);
    expect(contract.strategy.strategy).toBe("discover_and_plan");
    expect(contract.rationale).toBe("agent_architecture_overrides_follow_evidence");
  });

  it("keeps follow_evidence for Agent bugfix without architecture language", () => {
    const followEvidence: PlanStrategyDecision = {
      schemaVersion: 1,
      strategy: "follow_evidence",
      rationale: "in-scope errors",
      skipDiscover: true,
      useBuildEvidence: true,
    };
    const contract = applyPlanModeDiscoveryContract({
      mode: "agent",
      explorationDepth: "auto",
      query: "Fix all TypeScript errors in packages/mui-builder",
      conversation: [],
      strategy: followEvidence,
      planningDepth: "visible",
      agentWideScope: true,
    });
    expect(contract.applied).toBe(false);
    expect(contract.strategy.strategy).toBe("follow_evidence");
  });
});
