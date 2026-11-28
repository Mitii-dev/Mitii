import { describe, expect, it } from "vitest";
import {
  PLANNING_SCHEMA_VERSION,
  PlanningPipeline,
  formatPlanAsAnswer,
  inferPlanStrategyFromArtifact,
  serializePlanForPrompt,
  serializePlanText,
} from "../index";
import { baseInput } from "./planningHarness";

describe("PlanningPipeline strategy and impact", () => {
  const pipeline = new PlanningPipeline();

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
    expect(result.reasonCodes).not.toContain("plan_working_set_empty");
    expect(
      result.plan?.phases
        .flatMap((phase) => phase.steps)
        .some((step) => (step.mustRead?.length ?? 0) > 0),
    ).toBe(false);
  });

  it("emits plan_working_set_empty when hop-1 reports are missing on follow_evidence", async () => {
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
            { kind: "folder", value: "packages/mui-builder", explicit: true },
          ],
          constraints: [],
          requestedOutcomes: [
            "Resolve all TypeScript compilation/type errors in the target package",
          ],
          recommendsPlanning: true,
          recommendsVerification: false,
          changeImpact: ["code"],
        },
        processHints: [],
        buildEvidence: {
          phase: "before",
          summary: "1 error",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "packages/mui-builder/src/Button.tsx",
              severity: "error",
              message: "Type error",
              startLine: 1,
              code: "TS2322",
            },
          ],
        },
      }),
    );
    expect(result.strategy?.strategy).toBe("follow_evidence");
    expect(result.reasonCodes).toContain("plan_working_set_empty");
    expect(result.reasonCodes).not.toContain("plan_working_set_applied");
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

  it("uses clarify strategy for unclear asks in agent mode", async () => {
    const result = await pipeline.plan(
      baseInput({
        mode: "agent",
        route: "execute",
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

  it("plan mode defers unclear asks to discover_and_plan", async () => {
    const result = await pipeline.plan(
      baseInput({
        mode: "plan",
        route: "plan",
        query: "clean this up across the repo",
        evidence: {
          primaryIntent: "maintenance",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "repository",
          complexity: "complex",
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

    expect(result.strategy?.strategy).toBe("discover_and_plan");
    expect(result.reasonCodes).toContain(
      "plan_strategy_plan_mode_defers_unclear",
    );
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
    expect(answer).toMatch(/Plan ready \(\d+ steps?\)\./);
    expect(answer).toContain("Review steps in the plan strip");
    expect(answer).toMatch(/SSO|password login/i);
    expect(answer.length).toBeLessThan(1200);
    // Full dump stays on serializePlanText / prompt — not chat answer.
    expect(answer).not.toContain("Alternatives / tradeoffs:");
    expect(answer).not.toContain("Acceptance:");
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
      "bind to the listed evidence",
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
});
