import { describe, expect, it } from "vitest";
import { PlanningPipeline } from "../index";
import { fakeLlm, baseInput } from "./planningHarness";

describe("PlanningPipeline fallback and hollow drafts", () => {
  const pipeline = new PlanningPipeline();

  it("clarifies instead of shipping a hollow skeleton when medium Plan draft fails", async () => {
    const llmPipeline = new PlanningPipeline({ llm: fakeLlm(["not json"]) });
    const result = await llmPipeline.plan(
      baseInput({
        evidence: {
          primaryIntent: "feature",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "package",
          complexity: "moderate",
          risk: "medium",
          clarity: "clear",
          targets: [
            { kind: "folder", value: "packages/runner", explicit: true },
          ],
          constraints: [],
          requestedOutcomes: ["Improve verifiers"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
          taskSize: "medium",
        },
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Improve verifiers",
          filesRead: [
            { path: "packages/runner/src/verifiers.js", reason: "entrypoint" },
            { path: "packages/runner/src/http-check.js", reason: "related" },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "packages/runner/src/verifiers.js",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "read",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [{ kind: "test", reason: "suite tests" }],
          openQuestions: [],
          confidence: "medium",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Discovery found surfaces.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    // Clear single-outcome feature asks must NOT fall into harness A/B/C when
    // the model draft fails — keep discover_and_plan from discovery surfaces.
    expect(result.strategy?.strategy).toBe("discover_and_plan");
    expect(result.reasonCodes).not.toContain(
      "plan_discovery_draft_required_clarify",
    );
    expect(result.clarifyDraft).toBeUndefined();
    const change = result.plan?.phases.find((phase) => /change/i.test(phase.name));
    expect((change?.steps.length ?? 0) > 0).toBe(true);
  });

  it("clarifies hollow medium Plan drafts when the ask is a true multi-outcome fork", async () => {
    const llmPipeline = new PlanningPipeline({ llm: fakeLlm(["not json"]) });
    const result = await llmPipeline.plan(
      baseInput({
        query:
          "How I can improve the test cases? Can you plan or changing the architecture?",
        evidence: {
          primaryIntent: "refactor",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "package",
          complexity: "moderate",
          risk: "medium",
          clarity: "unclear",
          targets: [
            { kind: "folder", value: "packages/runner", explicit: true },
          ],
          constraints: [],
          requestedOutcomes: ["Improve tests or architecture"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
          taskSize: "medium",
        },
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Improve verifiers",
          filesRead: [
            { path: "packages/runner/src/verifiers.js", reason: "entrypoint" },
            { path: "packages/runner/src/http-check.js", reason: "related" },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "packages/runner/src/verifiers.js",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "read",
            },
          ],
          discoveredConstraints: [],
          verificationHints: [{ kind: "test", reason: "suite tests" }],
          openQuestions: [],
          confidence: "medium",
        },
        strategyOverride: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "Discovery found surfaces.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    expect(result.strategy?.strategy).toBe("clarify");
    expect(result.reasonCodes).toContain("plan_discovery_draft_required_clarify");
    const change = result.plan?.phases.find((phase) => /change/i.test(phase.name));
    expect(
      change?.steps.some(
        (step) =>
          step.id === "step-open-questions" ||
          /open questions/i.test(step.intent),
      ),
    ).toBe(true);
    expect(change?.steps[0]?.targetRefs ?? []).toEqual([]);
  });

  it("rejects truncated one-shot discovery drafts and uses the deterministic skeleton", async () => {
    const llmPipeline = new PlanningPipeline({
      llm: fakeLlm([
        {
          content: JSON.stringify({
            objective: "Add retry around the payment client",
            steps: [
              {
                phaseHint: "change",
                intent: "Partial model draft that should be ignored",
                actionSummary: "This JSON parses, but the response was truncated.",
                targetRefs: ["src/payments/client.ts"],
                expectedOutcome: "Should not be applied.",
              },
            ],
          }),
          finishReason: "length",
        },
      ]),
    });
    const result = await llmPipeline.plan(
      baseInput({
        evidence: {
          primaryIntent: "feature",
          secondaryIntents: [],
          interactionIntent: "plan",
          scope: "single_location",
          complexity: "simple",
          risk: "low",
          clarity: "clear",
          targets: [
            { kind: "file", value: "src/payments/client.ts", explicit: true },
          ],
          constraints: [],
          requestedOutcomes: ["Add retry around the payment client"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
          taskSize: "small",
        },
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
    expect(result.warnings.join("\n")).toContain("truncated");
    const change = result.plan?.phases.find((phase) => phase.name === "Change");
    expect(change?.steps[0]?.intent).not.toContain("Partial model draft");
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
});
