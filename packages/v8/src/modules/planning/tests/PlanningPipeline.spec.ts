import { describe, expect, it } from "vitest";

import {
  PLANNING_SCHEMA_VERSION,
  PlanningError,
  PlanningPipeline,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
  planningInputSchema,
  serializePlanForPrompt,
  serializePlanText,
} from "../index";
import type { LlmPort, ModelCapabilities } from "../../model-gateway";

const FAKE_CAPABILITIES: ModelCapabilities = {
  modelId: "fake-planning-model",
  contextWindowTokens: 16_000,
  maximumOutputTokens: 4_000,
  supportsStreaming: true,
  supportsTools: false,
  supportsParallelToolCalls: false,
  supportsStructuredOutput: true,
  supportsVision: false,
  supportsReasoning: false,
  supportsPromptCaching: false,
  supportsEmbeddings: false,
};

function fakeLlm(responses: readonly string[]): LlmPort {
  let index = 0;
  return {
    id: "fake-planning-llm",
    capabilities: FAKE_CAPABILITIES,
    async *complete() {
      const content = responses[index++] ?? "";
      yield { type: "content_delta" as const, content };
      yield { type: "completed" as const, finishReason: "stop" as const };
    },
  };
}

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

  it("drafts concrete diagnostic repair steps from preflight build evidence", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "@packages/mui-builder fix all the ts errors",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "act",
          scope: "package",
          complexity: "moderate",
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "2 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type 'number' is not assignable to type 'string'.",
              startLine: 42,
              source: "tsc",
              code: "TS2322",
            },
            {
              path: "packages/mui-builder/src/theme.ts",
              severity: "error",
              message: "Property 'palette' does not exist.",
              startLine: 7,
              source: "tsc",
              code: "TS2339",
            },
          ],
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];

    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(result.reasonCodes).toContain("plan_strategy_follow_evidence");
    expect(result.reasonCodes).toContain("plan_diagnostics_considered");
    expect(result.plan?.phases.map((phase) => phase.name)).toEqual([
      "Change",
      "Verify",
    ]);
    expect(changeSteps.map((step) => step.intent)).toEqual(
      expect.arrayContaining([
        "Fix TS2322 in packages/mui-builder/src/Button.tsx",
        "Fix TS2339 in packages/mui-builder/src/theme.ts",
      ]),
    );
    expect(changeSteps.map((step) => step.id)).not.toContain("step-implement");
    expect(changeSteps[0]?.targetRefs).toEqual([
      "packages/mui-builder/src/Button.tsx",
    ]);
    expect(serializePlanForPrompt(result.plan!, result.strategy)).toContain(
      "Skip rediscovery",
    );
  });

  it("splits a same-code diagnostic class into capped write batches", async () => {
    const files = Array.from(
      { length: 8 },
      (_, index) => `packages/mui-builder/src/file${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
        maxFilesPerBatch: 3,
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "8 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: files.map((path) => ({
            path,
            severity: "error",
            message: "Type 'number' is not assignable to type 'string'.",
            startLine: 1,
            source: "tsc",
            code: "TS2322",
          })),
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(changeSteps).toHaveLength(3);
    expect(changeSteps.map((step) => step.targetRefs.length)).toEqual([
      3, 3, 2,
    ]);
    expect(changeSteps.every((step) => step.targetRefs.length <= 3)).toBe(
      true,
    );
    expect(changeSteps[0]?.targetRefs).toEqual(files.slice(0, 3));
    expect(changeSteps[0]?.intent).toContain("(1/3)");
    expect(changeSteps[1]?.intent).toContain("(2/3)");
    expect(changeSteps[2]?.intent).toContain("(3/3)");
    expect(changeSteps.map((step) => step.id)).toEqual([
      "step-fix-diagnostic-1",
      "step-fix-diagnostic-2",
      "step-fix-diagnostic-3",
    ]);
  });

  it("keeps overflow diagnostic batches on the plan when maxDiagnosticSteps is smaller than the split", async () => {
    const files = Array.from(
      { length: 8 },
      (_, index) => `packages/mui-builder/src/file${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
        maxFilesPerBatch: 3,
        maxDiagnosticSteps: 2,
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "8 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: files.map((path) => ({
            path,
            severity: "error",
            message: "Type 'number' is not assignable to type 'string'.",
            startLine: 1,
            source: "tsc",
            code: "TS2322",
          })),
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(changeSteps).toHaveLength(3);
    expect(changeSteps.map((step) => step.targetRefs)).toEqual([
      files.slice(0, 3),
      files.slice(3, 6),
      files.slice(6, 8),
    ]);
  });

  it("keeps more diagnostic batches on the plan than the live task list can show", async () => {
    const files = Array.from(
      { length: 12 },
      (_, index) => `packages/mui-builder/src/file${index + 1}.ts`,
    );
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
        maxFilesPerBatch: 1,
        maxDiagnosticSteps: 2,
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "12 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: files.map((path) => ({
            path,
            severity: "error",
            message: "Type 'number' is not assignable to type 'string'.",
            startLine: 1,
            source: "tsc",
            code: "TS2322",
          })),
        },
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(changeSteps).toHaveLength(12);
    expect(changeSteps.every((step) => step.targetRefs.length === 1)).toBe(
      true,
    );
  });

  it("annotates follow_evidence change steps from hop-1 impact reports", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "Fix all the ts errors in packages/mui-builder",
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "1 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type 'number' is not assignable to type 'string'.",
              startLine: 42,
              source: "tsc",
              code: "TS2322",
            },
          ],
        },
        impactReports: [
          {
            seedPath: "packages/mui-builder/src/Button.tsx",
            mustRead: [
              "packages/mui-builder/src/Button.tsx",
              "packages/mui-builder/src/types.ts",
            ],
            affected: ["packages/mui-builder/src/Button.test.tsx"],
          },
        ],
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    const verifySteps =
      result.plan?.phases.find((phase) => phase.name === "Verify")?.steps ?? [];

    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(result.reasonCodes).toContain("plan_working_set_applied");
    expect(changeSteps[0]?.mustRead).toEqual([
      "packages/mui-builder/src/types.ts",
    ]);
    expect(changeSteps[0]?.affected).toEqual([
      "packages/mui-builder/src/Button.test.tsx",
    ]);
    expect(serializePlanText(result.plan!)).toContain(
      "need: packages/mui-builder/src/types.ts",
    );
    expect(verifySteps.some((step) => step.mustRead || step.affected)).toBe(
      false,
    );
  });

  it("annotates discover_and_plan change steps from hop-1 impact reports", async () => {
    const result = await pipeline.plan(
      baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add retry around the payment client",
          filesRead: [
            {
              path: "src/payments/client.ts",
              reason: "Outbound payment entrypoint",
            },
          ],
          targets: [
            {
              kind: "file",
              value: "src/payments/client.ts",
              reason: "Observed call site",
              explicit: false,
            },
          ],
          proposedChangeSurfaces: [
            {
              path: "src/payments/client.ts",
              actionHint: "Change",
              riskLevel: "medium",
              evidence: "Retries are missing around createCharge",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "high",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Discovery already identified concrete targets.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
        impactReports: [
          {
            seedPath: "src/payments/client.ts",
            mustRead: ["src/payments/client.ts", "src/payments/types.ts"],
            affected: ["src/payments/client.test.ts"],
          },
        ],
      }),
    );

    const changeSteps =
      result.plan?.phases.find((phase) => phase.name === "Change")?.steps ?? [];
    expect(result.strategy?.strategy).toBe("discover_and_plan");
    expect(result.reasonCodes).toContain("plan_working_set_applied");
    expect(changeSteps[0]?.mustRead).toEqual(["src/payments/types.ts"]);
    expect(changeSteps[0]?.affected).toEqual(["src/payments/client.test.ts"]);
  });

  it("does not annotate plan_from_ask steps even when impact reports are present", async () => {
    const result = await pipeline.plan(
      baseInput({
        strategyOverride: {
          schemaVersion: 1,
          strategy: "plan_from_ask",
          rationale: "Host override for a prose-first plan.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
        impactReports: [
          {
            seedPath: "src/auth",
            mustRead: ["src/auth/types.ts"],
            affected: ["src/app.ts"],
          },
        ],
      }),
    );

    expect(result.strategy?.strategy).toBe("plan_from_ask");
    expect(result.reasonCodes).not.toContain("plan_working_set_applied");
    expect(
      result.plan?.phases
        .flatMap((phase) => phase.steps)
        .some((step) => (step.mustRead?.length ?? 0) > 0),
    ).toBe(false);
  });

  it("does not let out-of-scope build diagnostics hijack a feature plan", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "Add SSO login in src/auth",
        buildEvidence: {
          phase: "before",
          summary: "1 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "packages/other/src/Broken.ts",
              severity: "error",
              message: "Unrelated failure",
              source: "tsc",
              code: "TS2322",
            },
          ],
        },
      }),
    );

    expect(result.strategy?.strategy).not.toBe("follow_evidence");
    expect(result.strategy?.useBuildEvidence).toBe(false);
    expect(result.reasonCodes).toContain("plan_build_evidence_out_of_scope");
    expect(result.reasonCodes).not.toContain("plan_diagnostics_considered");
    const intents =
      result.plan?.phases.flatMap((phase) =>
        phase.steps.map((step) => step.intent),
      ) ?? [];
    expect(intents.some((intent) => /packages\/other/.test(intent))).toBe(
      false,
    );
  });

  it("uses clarify strategy for unclear asks", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "clean this up",
        evidence: {
          primaryIntent: "maintenance",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "unknown",
          complexity: "moderate",
          risk: "medium",
          clarity: "unclear",
          targets: [],
          constraints: [],
          requestedOutcomes: [],
          recommendsPlanning: true,
          recommendsVerification: false,
          changeImpact: ["code"],
        },
      }),
    );

    expect(result.strategy?.strategy).toBe("clarify");
    expect(result.reasonCodes).toContain("plan_strategy_clarify");
  });

  it("resolves deterministically via rules — no strategy LLM call, ever", async () => {
    const result = await pipeline.plan(baseInput());
    expect(result.reasonCodes).toContain("plan_strategy_rules");
  });

  it("keeps a host-supplied follow_evidence override and only drops useBuildEvidence when no errors exist", async () => {
    const result = await pipeline.plan(
      baseInput({
        strategyOverride: {
          schemaVersion: 1,
          strategy: "follow_evidence",
          rationale: "test override",
          skipDiscover: true,
          useBuildEvidence: true,
        },
      }),
    );

    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(result.strategy?.skipDiscover).toBe(true);
    expect(result.strategy?.useBuildEvidence).toBe(false);
    expect(result.reasonCodes).toContain("plan_strategy_override");
    expect(result.plan?.phases.map((phase) => phase.name)).not.toContain(
      "Discover",
    );
  });

  it("does not treat the word error in a feature ask as repair evidence", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "Add SSO login without error handling regressions",
        buildEvidence: {
          phase: "before",
          summary: "1 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "src/auth/Login.tsx",
              severity: "error",
              message: "Type mismatch",
              source: "tsc",
              code: "TS2322",
            },
          ],
        },
      }),
    );

    expect(result.strategy?.strategy).not.toBe("follow_evidence");
    expect(result.reasonCodes).toContain("plan_strategy_rules");
    expect(result.plan?.phases.map((phase) => phase.name)).toContain(
      "Discover",
    );
  });

  it("serializes plan for prompt and answer", async () => {
    const result = await pipeline.plan(baseInput());
    const text = serializePlanForPrompt(result.plan!);
    expect(text).toContain('trust="instruction"');
    expect(text).toContain("Objective:");
    expect(text).toContain("write:");
    const answer = formatPlanAsAnswer(result.plan!);
    expect(answer).toContain("Plan:");
    expect(answer).toContain("Acceptance:");
    expect(answer).toContain("Alternatives / tradeoffs:");
    expect(answer).toContain("Risks / ifs:");
    expect(answer).toContain("Keep password login working");
  });

  it("infers follow_evidence from a Change-only concrete plan", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "@packages/mui-builder fix all the ts errors",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "act",
          scope: "package",
          complexity: "moderate",
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "1 error(s)",
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type mismatch",
              startLine: 12,
              code: "TS2322",
            },
          ],
        },
      }),
    );
    const inferred = inferPlanStrategyFromArtifact(result.plan!);
    expect(inferred.strategy).toBe("follow_evidence");
    expect(serializePlanForPrompt(result.plan!, inferred)).toContain(
      "Skip rediscovery",
    );
  });

  it("infers discover_and_plan when a Discover phase is present", async () => {
    const result = await pipeline.plan(baseInput());
    const inferred = inferPlanStrategyFromArtifact(result.plan!);
    expect(inferred.strategy).toBe("discover_and_plan");
    expect(inferred.skipDiscover).toBe(false);
    expect(serializePlanForPrompt(result.plan!, inferred)).toContain(
      "discovery already ran",
    );
  });

  it("infers plan_from_ask from a Change-only plan without file-scoped steps", () => {
    const plan = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Add a feature flag for SSO",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "module",
        risk: "low" as const,
        clarity: "clear",
        complexity: "simple",
        changeImpact: ["code" as const],
      },
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: "Implement the flag",
          steps: [
            {
              id: "step-flag",
              intent: "Add the SSO feature flag",
              targetRefs: ["src/auth"],
              actionSummary: "Introduce the flag behind existing login.",
              expectedOutcome: "SSO can be enabled without a new login path.",
              riskLevel: "low" as const,
            },
          ],
          dependencies: [],
          successCriteria: ["Flag exists"],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: [], manualQa: [], commands: [] },
      approvalRequired: false,
      processHintsApplied: [],
    };
    const inferred = inferPlanStrategyFromArtifact(plan);
    expect(inferred.strategy).toBe("plan_from_ask");
    expect(serializePlanForPrompt(plan, inferred)).toContain(
      "plan from the approved objective",
    );
  });

  it("maps a discovery brief into concrete change surfaces and skips Discover", async () => {
    const result = await pipeline.plan(
      baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add retry around the payment client",
          filesRead: [
            {
              path: "src/payments/client.ts",
              reason: "Outbound payment entrypoint",
            },
            {
              path: "src/payments/client.test.ts",
              reason: "Nearby unit test",
            },
          ],
          targets: [
            {
              kind: "file",
              value: "src/payments/client.ts",
              reason: "Observed call site",
              explicit: false,
            },
          ],
          proposedChangeSurfaces: [
            {
              path: "src/payments/client.ts",
              actionHint: "Change",
              riskLevel: "medium",
              evidence: "Retries are missing around createCharge",
            },
          ],
          discoveredConstraints: ["Keep existing error mapping"],
          verificationHints: [
            { kind: "test", reason: "Update the nearby client test" },
          ],
          openQuestions: [],
          confidence: "high",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Read-only discovery already identified concrete targets.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    expect(result.strategy?.skipDiscover).toBe(true);
    expect(result.plan?.phases.map((phase) => phase.name)).not.toContain(
      "Discover",
    );
    expect(result.plan?.contextReviewed.map((item) => item.ref)).toEqual(
      expect.arrayContaining(["src/payments/client.ts"]),
    );
    expect(result.plan?.constraints).toContain("Keep existing error mapping");
    const change = result.plan?.phases.find((phase) => phase.name === "Change");
    expect(change?.steps[0]?.targetRefs).toEqual(["src/payments/client.ts"]);
    expect(change?.steps[0]?.intent).toContain("src/payments/client.ts");
    expect(result.reasonCodes).toContain("plan_discovery_applied");
    expect(result.reasonCodes).toContain("plan_strategy_override");
    const inferred = inferPlanStrategyFromArtifact(result.plan!);
    expect(inferred.strategy).toBe("discover_and_plan");
    expect(inferred.skipDiscover).toBe(true);
  });

  it("drafts Change+Verify steps from the one-shot discover_and_plan model call, filtered to the discovery allowlist", async () => {
    const llmPipeline = new PlanningPipeline({
      llm: fakeLlm([
        JSON.stringify({
          objective: "Add retry around the payment client",
          steps: [
            {
              phaseHint: "change",
              intent: "Add retry handling to the payment client",
              actionSummary: "Use the existing payment client seam.",
              targetRefs: ["outside/payments.ts", "src/payments/client.ts"],
              expectedOutcome: "Payment requests retry safely.",
            },
            {
              phaseHint: "change",
              intent: "Keep the existing error mapping",
              actionSummary: "Do not rewrite payment error types.",
              targetRefs: ["src/payments/client.ts"],
              expectedOutcome: "Existing error mapping stays intact.",
            },
          ],
        }),
      ]),
    });
    const result = await llmPipeline.plan(
      baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add retry around the payment client",
          filesRead: [
            {
              path: "src/payments/client.ts",
              reason: "Outbound payment entrypoint",
            },
          ],
          targets: [
            {
              kind: "file",
              value: "src/payments/client.ts",
              reason: "Observed call site",
              explicit: false,
            },
          ],
          proposedChangeSurfaces: [
            {
              path: "src/payments/client.ts",
              actionHint: "Change",
              riskLevel: "medium",
              evidence: "Retries are missing around createCharge",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "high",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Read-only discovery already identified concrete targets.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    const change = result.plan?.phases.find((phase) => phase.name === "Change");
    expect(result.plan?.phases.map((phase) => phase.name)).not.toContain(
      "Discover",
    );
    expect(result.reasonCodes).toContain("plan_drafted_from_discovery");
    expect(change?.steps[0]?.targetRefs).toEqual(["src/payments/client.ts"]);
    expect(change?.steps[0]?.targetRefs).not.toContain("outside/payments.ts");
    expect(change?.steps).toHaveLength(2);
    expect(change?.steps[1]?.intent).toContain("error mapping");
  });

  it("falls back to the deterministic discovery skeleton when the one-shot model draft is invalid", async () => {
    const llmPipeline = new PlanningPipeline({ llm: fakeLlm(["not json"]) });
    const result = await llmPipeline.plan(
      baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add retry around the payment client",
          filesRead: [
            {
              path: "src/payments/client.ts",
              reason: "Outbound payment entrypoint",
            },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "src/payments/client.ts",
              actionHint: "Change",
              riskLevel: "medium",
              evidence: "Retries are missing around createCharge",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "high",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Read-only discovery already identified concrete targets.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    expect(result.reasonCodes).toContain("plan_discovery_draft_failed_fallback");
    expect(result.plan?.phases.map((phase) => phase.name)).not.toContain(
      "Discover",
    );
    const change = result.plan?.phases.find((phase) => phase.name === "Change");
    expect(change?.steps[0]?.targetRefs).toEqual(["src/payments/client.ts"]);
  });

  it("keeps preflight diagnostic steps when skill phase hints are present", async () => {
    const result = await pipeline.plan(
      baseInput({
        query: "@packages/mui-builder fix all the ts errors",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "act",
          scope: "package",
          complexity: "moderate",
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        skills: [
          {
            id: "skill-typescript-repair",
            title: "TypeScript repair",
            priority: 10,
            content: [
              "Planning:",
              "Discover:",
              "- Read failing typecheck output",
              "Change:",
              "- Apply focused type fixes",
              "Verify:",
              "- Re-run typecheck",
            ].join("\n"),
          },
        ],
        buildEvidence: {
          phase: "before",
          summary: "1 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type mismatch",
              startLine: 12,
              source: "tsc",
              code: "TS2322",
            },
          ],
        },
        scopedRepoMap: {
          entries: [
            { path: "packages/mui-builder/src/Button.tsx", kind: "file" },
            { path: "packages/mui-builder", kind: "folder" },
          ],
        },
      }),
    );

    const changePhase = result.plan?.phases.find((phase) =>
      /change/i.test(phase.name),
    );
    expect(changePhase?.steps.some((step) =>
      step.id.startsWith("step-fix-diagnostic-"),
    )).toBe(true);
    expect(changePhase?.steps[0]?.targetRefs).toEqual([
      "packages/mui-builder/src/Button.tsx",
    ]);
    expect(result.plan?.contextReviewed.map((item) => item.ref)).toEqual(
      expect.arrayContaining([
        "packages/mui-builder/src/Button.tsx",
        "packages/mui-builder",
      ]),
    );
  });

  it("keeps open questions and does not invent file tasks when discovery is insufficient", async () => {
    const result = await pipeline.plan(
      baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Investigate the request",
          filesRead: [],
          targets: [],
          proposedChangeSurfaces: [],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [
            "Which concrete files or symbols should change for this request?",
          ],
          confidence: "low",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Discovery did not find a concrete surface.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    expect(result.plan?.openQuestions[0]).toMatch(/concrete files/i);
    expect(
      result.plan?.phases
        .flatMap((phase) => phase.steps)
        .some((step) => step.targetRefs.some((ref) => /\.\w+$/.test(ref))),
    ).toBe(false);
    expect(result.reasonCodes).toContain("plan_discovery_insufficient");
  });

  it("suppresses generic clarity/scope open questions when discovery is file-backed", async () => {
    const result = await pipeline.plan(
      baseInput({
        evidence: {
          primaryIntent: "feature",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "unknown",
          complexity: "simple",
          risk: "low",
          clarity: "unclear",
          targets: [],
          constraints: [],
          requestedOutcomes: [
            "Plan to implement headless for desktop and tablet",
          ],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        processHints: [],
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Plan to implement headless for desktop and tablet",
          filesRead: [
            {
              path: "test/shared/config/testConfig.ts",
              reason: "Preferred seed path",
            },
            {
              path: "wdio.desktop.conf.ts",
              reason: "Preferred seed path",
            },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "test/shared/config/testConfig.ts",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "Preferred seed path",
            },
            {
              path: "wdio.desktop.conf.ts",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "Preferred seed path",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "high",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Plan mode discovery",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    expect(result.plan?.openQuestions ?? []).toEqual([]);
    expect(
      (result.plan?.openQuestions ?? []).some((q) =>
        /which outcome is in scope/i.test(q),
      ),
    ).toBe(false);
    expect(
      (result.plan?.openQuestions ?? []).some((q) =>
        /modules or packages are in scope/i.test(q),
      ),
    ).toBe(false);
  });

  it("classifies strategy without drafting a plan", async () => {
    const classified = await pipeline.resolveStrategy(
      baseInput({
        query: "@packages/mui-builder fix all the ts errors",
        evidence: {
          primaryIntent: "bugfix",
          secondaryIntents: [],
          interactionIntent: "act",
          scope: "package",
          complexity: "moderate",
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
          requestedOutcomes: ["Fix all TypeScript errors"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        buildEvidence: {
          phase: "before",
          summary: "1 error(s)",
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type mismatch",
              startLine: 12,
              code: "TS2322",
            },
          ],
        },
      }),
    );
    expect(classified.decision.strategy).toBe("follow_evidence");
    expect(classified.decision.skipDiscover).toBe(true);
  });

  it("throws PlanningError on invalid input", async () => {
    await expect(
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
    ).rejects.toThrow(PlanningError);
  });
});
