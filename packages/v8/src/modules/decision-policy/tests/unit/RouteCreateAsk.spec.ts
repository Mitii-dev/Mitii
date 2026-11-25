import { describe, expect, it } from "vitest";

import { resolveRoute } from "../../helpers/ResolveRoute";
import { isExplicitCreateAsk } from "../../helpers/RouteCreateAsk";
import { DECISION_REASON_CODES } from "../../constants";
import { createUnderstanding } from "../fixtures/decisionCases";

describe("isExplicitCreateAsk", () => {
  it.each([
    "Create an Express server in src/server.ts with a /health route",
    "Please build a todo app with React",
    "Can you scaffold a CLI tool for log parsing?",
    "I need you to implement a rate limiter in src/limiter.ts",
    "Add a login endpoint to the API",
  ])("accepts %j", (message) => {
    expect(isExplicitCreateAsk(message)).toBe(true);
  });

  it.each([
    "Create a plan for the new billing service",
    "Create a step-by-step plan for SSO migration",
    "Plan only: build a dashboard",
    "Build a roadmap for the auth rewrite",
    "How do I create an Express server?",
    "Explain how to build a todo app",
    "Create a todo app but do not change any files",
    "",
  ])("rejects %j", (message) => {
    expect(isExplicitCreateAsk(message)).toBe(false);
  });
});

describe("resolveRoute: create asks in agent mode", () => {
  const planBallot = createUnderstanding({
    primaryTaskIntent: "feature",
    interactionIntent: "plan",
    taskAnalysis: { scope: "multi_file", complexity: "moderate" },
  });

  it("executes an explicit create ask even when the ballot says plan", () => {
    const result = resolveRoute({
      mode: "agent",
      understanding: planBallot,
      message: "Create an Express server in src/server.ts with a /health route",
    });
    expect(result.route).toBe("execute");
    expect(result.reasonCodes).toContain("agent_create_ask_execute");
    expect(result.reasonCodes).not.toContain("explicit_plan_request");
  });

  it("keeps plan-only when the message asks for a plan", () => {
    const result = resolveRoute({
      mode: "agent",
      understanding: planBallot,
      message: "Create a plan to add SSO, but do not implement it yet.",
    });
    expect(result.route).toBe("plan");
    expect(result.reasonCodes).toContain("explicit_plan_request");
  });

  it("keeps plan-only for a plan ballot without a create ask", () => {
    const result = resolveRoute({
      mode: "agent",
      understanding: planBallot,
      message: "How should we structure the billing service?",
    });
    expect(result.route).toBe("plan");
  });

  it("does not change plan mode", () => {
    const result = resolveRoute({
      mode: "plan",
      understanding: planBallot,
      message: "Create an Express server in src/server.ts",
    });
    expect(result.route).toBe("plan");
  });

  it("emits a reason code declared in the contract", () => {
    expect(DECISION_REASON_CODES).toContain("agent_create_ask_execute");
  });
});
