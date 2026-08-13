import { describe, expect, it } from "vitest";

import {
  PLANNING_SCHEMA_VERSION,
  PlanningError,
  PlanningPipeline,
  formatPlanAsAnswer,
  planningInputSchema,
  serializePlanForPrompt,
} from "../index";

function baseInput(
  overrides: Record<string, unknown> = {},
): Parameters<PlanningPipeline["plan"]>[0] {
  return planningInputSchema.parse({
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: "Add SSO login without breaking password login",
    mode: "plan",
    route: "plan",
    planningDepth: "visible",
    evidence: {
      primaryIntent: "feature",
      secondaryIntents: [],
      interactionIntent: "plan",
      scope: "package",
      complexity: "complex",
      risk: "high",
      clarity: "partially_clear",
      targets: [{ kind: "folder", value: "src/auth", explicit: true }],
      constraints: ["Keep password login working"],
      requestedOutcomes: ["Add SSO login without breaking password login"],
      recommendsPlanning: true,
      recommendsVerification: true,
      changeImpact: ["code", "config", "security"],
    },
    processHints: ["auth_identity"],
    ...overrides,
  });
}

describe("PlanningPipeline", () => {
  const pipeline = new PlanningPipeline();

  it("drafts a generic PlanArtifact from dimensions", () => {
    const result = pipeline.plan(baseInput());
    expect(result.status === "validated" || result.status === "compacted").toBe(
      true,
    );
    expect(result.plan).toBeDefined();
    expect(result.plan!.phases.length).toBeGreaterThanOrEqual(2);
    expect(result.plan!.dimensions.risk).toBe("high");
    expect(result.plan!.approvalRequired).toBe(true);
    expect(result.plan!.processHintsApplied).toContain("auth_identity");
    expect(result.plan!.openQuestions.some((q) => /provider/i.test(q))).toBe(
      true,
    );
    expect(result.reasonCodes).toContain("plan_drafted");
    expect(result.reasonCodes).toContain("plan_process_hints_applied");
  });

  it("returns blocked when planningDepth is none", () => {
    const result = pipeline.plan(baseInput({ planningDepth: "none" }));
    expect(result.status).toBe("blocked");
    expect(result.plan).toBeUndefined();
    expect(result.reasonCodes).toContain("plan_depth_none");
  });

  it("accepts skills slot without requiring Skills module", () => {
    const result = pipeline.plan(
      baseInput({
        skills: [
          {
            id: "skill_auth",
            title: "Auth guidance",
            content: "Prefer configurable OIDC over vendor hardcoding.",
            priority: 100,
          },
        ],
      }),
    );
    expect(result.plan).toBeDefined();
    expect(result.reasonCodes).toContain("plan_skills_considered");
  });

  it("uses selected skill planning phases when available", () => {
    const result = pipeline.plan(
      baseInput({
        skills: [
          {
            id: "planning-default",
            title: "Default Planning",
            content: [
              "Skill: Default Planning",
              "Description: Plan repository work with Discover, Change, and Verify phases.",
              "Planning:",
              "Discover:",
              "- Locate current behavior",
              "- Collect evidence",
              "",
              "Change:",
              "- Choose non-hardcoded extension approach",
              "- Implement smallest coherent change",
              "",
              "Verify:",
              "- Run lint/typecheck/tests",
            ].join("\n"),
            priority: 180,
          },
        ],
      }),
    );

    expect(result.plan?.phases.map((phase) => phase.name)).toEqual([
      "Discover",
      "Change",
      "Verify",
    ]);
    expect(result.plan?.phases[0]?.steps.map((step) => step.intent)).toEqual([
      "Locate current behavior",
      "Collect evidence",
    ]);
    expect(result.plan?.phases[1]?.steps.map((step) => step.intent)).toContain(
      "Implement smallest coherent change",
    );
    expect(result.plan?.phases[2]?.steps[0]?.verification).toContain(
      "typecheck",
    );
    expect(result.reasonCodes).toContain("plan_skills_considered");
  });

  it("does not ingest skill playbook or when-to-use bullets as plan steps", () => {
    const result = pipeline.plan(
      baseInput({
        skills: [
          {
            id: "planning-and-task-breakdown",
            title: "Planning and Task Breakdown",
            content: [
              "# Planning",
              "",
              "Discover:",
              "- Restate the goal and constraints from the spec",
              "- Identify dependencies and risky areas",
              "",
              "Change:",
              "- Produce ordered tasks with acceptance criteria",
              "- Keep each task small enough to verify independently",
              "",
              "Verify:",
              "- Every task has a clear done check",
              "- Order respects dependencies",
              "",
              "# Playbook",
              "",
              "## When to Use",
              "- You have a spec and need to break it into implementable units",
              "- A task feels too large or vague to start",
              "- Work needs to be parallelized across multiple agents or sessions",
            ].join("\n"),
            priority: 190,
          },
        ],
      }),
    );

    const intents =
      result.plan?.phases.flatMap((phase) =>
        phase.steps.map((step) => step.intent),
      ) ?? [];
    expect(intents).toContain("Restate the goal and constraints from the spec");
    expect(intents.some((intent) => /you have a spec/i.test(intent))).toBe(
      false,
    );
    expect(intents.some((intent) => /feels too large/i.test(intent))).toBe(
      false,
    );
    expect(intents.some((intent) => /parallelized/i.test(intent))).toBe(false);
  });

  it("serializes plan for prompt and answer", () => {
    const result = pipeline.plan(baseInput());
    const text = serializePlanForPrompt(result.plan!);
    expect(text).toContain('trust="instruction"');
    expect(text).toContain("Objective:");
    expect(formatPlanAsAnswer(result.plan!)).toContain("Plan:");
  });

  it("throws PlanningError on invalid input", () => {
    expect(() =>
      pipeline.plan({
        schemaVersion: 999,
        query: "x",
        mode: "plan",
        route: "plan",
        planningDepth: "visible",
        evidence: {
          primaryIntent: "feature",
          scope: "package",
          complexity: "simple",
          risk: "low",
          clarity: "clear",
        },
      } as never),
    ).toThrow(PlanningError);
  });
});
