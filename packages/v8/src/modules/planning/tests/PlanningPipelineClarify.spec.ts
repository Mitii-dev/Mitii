import { describe, expect, it } from "vitest";
import { PlanningPipeline, formatPlanAsAnswer } from "../index";
import { fakeLlm, baseInput } from "./planningHarness";

describe("PlanningPipeline clarify", () => {
  const pipeline = new PlanningPipeline();

  it("does not re-clarify a hollow skeleton when Plan scope was already chosen", async () => {
    const llmPipeline = new PlanningPipeline({ llm: fakeLlm(["not json"]) });
    const result = await llmPipeline.plan(
      baseInput({
        query:
          "Improve test cases\n\nClarification: C) Runner / architecture changes — Redesign grading DSL",
        evidence: {
          primaryIntent: "refactor",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "repository",
          complexity: "complex",
          risk: "medium",
          clarity: "unclear",
          targets: [],
          constraints: [],
          requestedOutcomes: ["Runner / architecture changes"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
          taskSize: "medium",
        },
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Runner architecture",
          filesRead: [
            { path: "packages/runner/src/import-solid.js", reason: "seed" },
            { path: "packages/runner/test/grade-compiler.test.js", reason: "test" },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "packages/runner/src/import-solid.js",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "read",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "medium",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Scope choice resolved.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    expect(result.strategy?.strategy).not.toBe("clarify");
    expect(result.reasonCodes).not.toContain(
      "plan_discovery_draft_required_clarify",
    );
    expect(result.clarifyDraft).toBeUndefined();
  });

  it("clarify strategy returns findings + A/B/C clarifyDraft", async () => {
    const result = await pipeline.plan(
      baseInput({
        query:
          "How I can improve the test cases? Can you plan or changing the architecture?",
        evidence: {
          primaryIntent: "refactor",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "repository",
          complexity: "complex",
          risk: "medium",
          clarity: "unclear",
          targets: [],
          constraints: [],
          requestedOutcomes: ["Improve test cases or change architecture"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
          taskSize: "medium",
        },
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Improve test cases",
          filesRead: [
            { path: "docs/GRADING_AND_DRY_RUN.md", reason: "seed" },
          ],
          targets: [],
          proposedChangeSurfaces: [],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "low",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "clarify",
          rationale: "Discovery insufficient.",
          skipDiscover: true,
          useBuildEvidence: false,
          confidence: 0.4,
        },
      }),
    );

    expect(result.strategy?.strategy).toBe("clarify");
    expect(result.clarifyDraft?.scopeOptions.length).toBeGreaterThanOrEqual(2);
    expect(result.reasonCodes).toContain("plan_clarify_draft_fallback");
    expect(
      formatPlanAsAnswer(
        result.plan!,
        result.strategy,
        result.clarifyDraft,
      ),
    ).toMatch(/Need a scope choice before locking a plan/i);
  });

  it("clarify strategy never drafts Change surfaces from partial discovery", async () => {
    const result = await pipeline.plan(
      baseInput({
        query:
          "How I can improve the test cases? Can you plan or changing the architecture?",
        evidence: {
          primaryIntent: "refactor",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "repository",
          complexity: "complex",
          risk: "medium",
          clarity: "unclear",
          targets: [],
          constraints: [],
          requestedOutcomes: [
            "Improve test cases or change architecture",
          ],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
          taskSize: "medium",
        },
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Improve test cases or change architecture",
          filesRead: [
            {
              path: ".github/ISSUE_TEMPLATE/case-idea.yml",
              reason: "seed",
            },
            {
              path: "docs/GRADING_AND_DRY_RUN.md",
              reason: "seed",
            },
            {
              path: "scripts/data/react-realworld-cases.mjs",
              reason: "seed",
            },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: ".github/ISSUE_TEMPLATE/case-idea.yml",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "seed read",
            },
            {
              path: "docs/GRADING_AND_DRY_RUN.md",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "seed read",
            },
            {
              path: "scripts/data/react-realworld-cases.mjs",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "seed read",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: [],
          confidence: "medium",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "clarify",
          rationale:
            "Plan requires multi-file, multi-surface discovery before a concrete plan; evidence was insufficient.",
          skipDiscover: true,
          useBuildEvidence: false,
          confidence: 0.4,
        },
      }),
    );

    expect(result.strategy?.strategy).toBe("clarify");
    expect(result.reasonCodes).toContain("plan_strategy_clarify");
    const steps = result.plan?.phases.flatMap((phase) => phase.steps) ?? [];
    expect(
      steps.some(
        (step) =>
          step.id === "step-open-questions" ||
          /open questions/i.test(step.intent),
      ),
    ).toBe(true);
    expect(
      steps.some((step) =>
        step.targetRefs.some(
          (ref) =>
            /ISSUE_TEMPLATE|GRADING_AND_DRY_RUN|react-realworld-cases/i.test(
              ref,
            ),
        ),
      ),
    ).toBe(false);
    expect(
      steps.every((step) => step.targetRefs.length === 0),
    ).toBe(true);
    expect(result.plan?.openQuestions.length ?? 0).toBeGreaterThan(0);
    expect(
      /smallest coherent change/i.test(
        result.plan?.phases.map((p) => p.purpose).join(" ") ?? "",
      ),
    ).toBe(false);
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
});
