import { describe, expect, it } from "vitest";
import { PlanningPipeline } from "../index";
import { baseInput } from "./planningHarness";

describe("PlanningPipeline", () => {
  const pipeline = new PlanningPipeline();

  it("drafts a request-specific PlanArtifact from dimensions", async () => {
    const result = await pipeline.plan(baseInput());
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

  it("sanitizes @mentions and drafts repair-shaped steps from bugfix intent", async () => {
    const result = await pipeline.plan(
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
    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(result.strategy?.skipDiscover).toBe(true);
    expect(result.plan?.phases.map((phase) => phase.name)).toEqual([
      "Change",
      "Verify",
    ]);
    const intents =
      result.plan?.phases.flatMap((phase) =>
        phase.steps.map((step) => step.intent),
      ) ?? [];
    expect(intents).not.toContain(
      "Inspect failure evidence in packages/mui-builder",
    );
    expect(intents).not.toContain(
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
    const verifyStep = result.plan?.phases
      .find((phase) => phase.name === "Verify")
      ?.steps[0];
    expect(verifyStep?.verification).toMatch(/lint/);
    expect(verifyStep?.verification).toMatch(/typecheck/);
    expect(verifyStep?.actionSummary).toMatch(/focused tests/);
  });

  it("expands Verify into one step per discovery command", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "Add SSO login without breaking password login",
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add SSO login",
          filesRead: [
            { path: "src/auth/login.ts", reason: "Login surface" },
          ],
          targets: [
            {
              kind: "file",
              value: "src/auth/login.ts",
              reason: "Primary surface",
              explicit: true,
            },
          ],
          proposedChangeSurfaces: [
            {
              path: "src/auth/login.ts",
              actionHint: "Wire SSO",
              riskLevel: "medium",
              evidence: "Login entry",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [
            {
              kind: "typecheck",
              reason: "Typed package",
              command: "pnpm typecheck",
            },
            {
              kind: "test",
              reason: "Auth tests",
              command: "pnpm test -- src/auth",
            },
          ],
          openQuestions: [],
          confidence: "high",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "test",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );
    const verifySteps =
      result.plan?.phases.find((phase) => phase.name === "Verify")?.steps ?? [];
    expect(verifySteps.map((step) => step.intent)).toEqual([
      "Run pnpm typecheck in src/auth/login.ts",
      "Run pnpm test -- src/auth in src/auth/login.ts",
    ]);
  });

  it("keeps destination package path in port/create objectives", async () => {
    const result = await pipeline.plan(
      baseInput({
        query:
          "Create @packages/mui-builder as a full port of @packages/formik-form-builder, but with MUI Material instead of Joy.",
        evidence: {
          primaryIntent: "migrate",
          secondaryIntents: ["feature"],
          interactionIntent: "act",
          scope: "multi_file",
          complexity: "moderate",
          risk: "medium",
          clarity: "clear",
          targets: [
            {
              kind: "folder",
              value: "packages/mui-builder",
              explicit: true,
            },
            {
              kind: "folder",
              value: "packages/formik-form-builder",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: [
            "Create @packages/mui-builder as a full port of @packages/formik-form-builder, but with MUI Material instead of Joy.",
          ],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        processHints: [],
      }),
    );

    expect(result.status).toBe("validated");
    expect(result.plan?.objective).toMatch(/packages\/mui-builder/i);
    expect(result.plan?.objective).toMatch(/full port/i);
    expect(result.plan?.objective.includes("@")).toBe(false);
  });

  it("returns blocked when planningDepth is none", async () => {
    const result = await pipeline.plan(baseInput({ planningDepth: "none" }));
    expect(result.status).toBe("blocked");
    expect(result.plan).toBeUndefined();
    expect(result.reasonCodes).toContain("plan_depth_none");
  });

  it("accepts skills slot without requiring Skills module", async () => {
    const result = await pipeline.plan(
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

  it("uses selected skill planning phases when available", async () => {
    const result = await pipeline.plan(
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

  it("does not ingest skill playbook or task-breakdown methodology as plan steps", async () => {
    const result = await pipeline.plan(
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
});
