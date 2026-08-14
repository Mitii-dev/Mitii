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

  it("drafts a request-specific PlanArtifact from dimensions", () => {
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

    const intents =
      result.plan!.phases.flatMap((phase) =>
        phase.steps.map((step) => step.intent),
      ) ?? [];
    expect(intents.some((intent) => /src\/auth/i.test(intent))).toBe(true);
    expect(intents.some((intent) => /@packages\//i.test(intent))).toBe(false);
    expect(
      result.plan!.objective.toLowerCase().includes("sso login"),
    ).toBe(true);
    expect(result.plan!.objective.includes("@")).toBe(false);
    expect(
      result.plan!.phases.some((phase) =>
        phase.successCriteria.some((item) =>
          /Keep password login working/i.test(item),
        ),
      ),
    ).toBe(true);
    expect(
      result.plan!.alternatives.some((item) => /constraint/i.test(item.id)),
    ).toBe(true);
  });

  it("sanitizes @mentions and drafts repair-shaped steps from bugfix intent", () => {
    const result = pipeline.plan(
      baseInput({
        query: "@packages/mui-builder\n@packages/mui-builder fix all the ts errors",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "package",
          complexity: "simple",
          risk: "low",
          clarity: "clear",
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: [
            "@packages/mui-builder fix all the ts errors",
            "Resolve all TypeScript compilation/type errors in the target package",
          ],
          recommendsPlanning: true,
          recommendsVerification: false,
          changeImpact: ["code"],
        },
        processHints: [],
      }),
    );

    expect(result.plan?.objective).toBe(
      "Resolve all TypeScript compilation/type errors in the target package",
    );
    expect(result.plan?.objective.includes("@")).toBe(false);
    expect(result.plan?.phases.map((phase) => phase.name)).toEqual([
      "Discover",
      "Change",
      "Verify",
    ]);
    const intents =
      result.plan?.phases.flatMap((phase) =>
        phase.steps.map((step) => step.intent),
      ) ?? [];
    expect(intents).toContain("Inspect failure evidence in packages/mui-builder");
    expect(intents).toContain(
      "Bound failing surfaces and constraints in packages/mui-builder",
    );
    expect(intents).toContain(
      "Resolve all TypeScript compilation/type errors in the target package",
    );
    expect(intents).toContain("Verify the fix in packages/mui-builder");
    expect(
      intents.some((intent) => /non-hardcoded approach/i.test(intent)),
    ).toBe(false);
    expect(intents.some((intent) => /typescript \/ type errors/i.test(intent))).toBe(
      false,
    );
    expect(intents.some((intent) => /typecheck is clean/i.test(intent))).toBe(
      false,
    );
    const doneWhen =
      result.plan?.phases.flatMap((phase) => phase.successCriteria) ?? [];
    expect(doneWhen.some((item) => item.includes("@packages/"))).toBe(false);
    expect(doneWhen.some((item) => item.startsWith("Done when:"))).toBe(false);
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
      "Locate current behavior in src/auth",
      "Collect evidence in src/auth",
    ]);
    expect(result.plan?.phases[1]?.steps.map((step) => step.intent)).toContain(
      "Implement smallest coherent change in src/auth",
    );
    expect(result.plan?.phases[2]?.steps[0]?.verification).toContain(
      "typecheck",
    );
    expect(result.reasonCodes).toContain("plan_skills_considered");
  });

  it("does not ingest skill playbook or task-breakdown methodology as plan steps", () => {
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
    expect(intents.some((intent) => /restate the goal/i.test(intent))).toBe(
      false,
    );
    expect(
      intents.some((intent) => /produce ordered tasks/i.test(intent)),
    ).toBe(false);
    expect(intents.some((intent) => /you have a spec/i.test(intent))).toBe(
      false,
    );
    expect(intents.some((intent) => /feels too large/i.test(intent))).toBe(
      false,
    );
    expect(intents.some((intent) => /parallelized/i.test(intent))).toBe(false);
    // Falls back to dimension-driven request-specific steps.
    expect(
      intents.some((intent) => /Inspect current behavior in src\/auth/i.test(intent)),
    ).toBe(true);
    expect(
      intents.some((intent) =>
        /Add SSO login without breaking password login in src\/auth/i.test(
          intent,
        ),
      ),
    ).toBe(true);
    expect(
      intents.some((intent) => /Verify changes in src\/auth/i.test(intent)),
    ).toBe(true);
  });

  it("serializes plan for prompt and answer", () => {
    const result = pipeline.plan(baseInput());
    const text = serializePlanForPrompt(result.plan!);
    expect(text).toContain('trust="instruction"');
    expect(text).toContain("Objective:");
    const answer = formatPlanAsAnswer(result.plan!);
    expect(answer).toContain("Plan:");
    expect(answer).toContain("Acceptance:");
    expect(answer).toContain("Alternatives / tradeoffs:");
    expect(answer).toContain("Risks / ifs:");
    expect(answer).toContain("Keep password login working");
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
