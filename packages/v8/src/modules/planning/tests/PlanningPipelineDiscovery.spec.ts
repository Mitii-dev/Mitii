import { describe, expect, it } from "vitest";
import { PlanningPipeline, inferPlanStrategyFromArtifact } from "../index";
import { fakeLlm, baseInput } from "./planningHarness";

describe("PlanningPipeline discovery", () => {
  const pipeline = new PlanningPipeline();

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

  it("drops unobserved prompt-only paths after non-thin discovery (Vite vs Next)", async () => {
    const llmPipeline = new PlanningPipeline({
      llm: fakeLlm([
        JSON.stringify({
          objective: "Build a GDPR cookie consent banner",
          steps: [
            {
              phaseHint: "change",
              intent: "Create cookie banner in Next page",
              actionSummary: "Add client component banner.",
              targetRefs: ["app/page.jsx", "src/App.jsx"],
              expectedOutcome: "Banner stores cookies_accepted in localStorage.",
            },
          ],
        }),
      ]),
    });
    const result = await llmPipeline.plan(
      baseInput({
        query: "Build a GDPR cookie consent banner",
        evidence: {
          primaryIntent: "feature",
          secondaryIntents: [],
          interactionIntent: "act",
          scope: "single_location",
          complexity: "moderate",
          risk: "low",
          clarity: "clear",
          targets: [
            {
              kind: "file",
              value: "app/page.jsx",
              explicit: true,
            },
          ],
          constraints: [],
          requestedOutcomes: ["Build a GDPR cookie consent banner"],
          recommendsPlanning: true,
          recommendsVerification: true,
          changeImpact: ["code"],
        },
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Build a GDPR cookie consent banner",
          filesRead: [
            { path: "src/App.jsx", reason: "Vite React entry component" },
            { path: "src/main.jsx", reason: "Vite mount entry" },
            { path: "package.json", reason: "Fixture package metadata" },
          ],
          targets: [
            {
              kind: "file",
              value: "app/page.jsx",
              reason: "Extracted from shared prompt",
              explicit: true,
            },
          ],
          proposedChangeSurfaces: [
            {
              path: "src/App.jsx",
              actionHint: "Change",
              riskLevel: "low",
              evidence: "Mounted UI surface for the cookie banner",
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
          rationale: "Discovery already identified the Vite entrypoint.",
          skipDiscover: true,
          useBuildEvidence: false,
        },
      }),
    );

    const change = result.plan?.phases.find((phase) => phase.name === "Change");
    expect(change?.steps[0]?.targetRefs).toContain("src/App.jsx");
    expect(change?.steps[0]?.targetRefs).not.toContain("app/page.jsx");
  });

  it("falls back to the deterministic discovery skeleton when the one-shot model draft is invalid", async () => {
    const llmPipeline = new PlanningPipeline({ llm: fakeLlm(["not json"]) });
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
    expect(result.reasonCodes).not.toContain(
      "plan_discovery_draft_required_clarify",
    );
    expect(result.plan?.phases.map((phase) => phase.name)).not.toContain(
      "Discover",
    );
    const change = result.plan?.phases.find((phase) => phase.name === "Change");
    expect(change?.steps[0]?.targetRefs).toEqual(["src/payments/client.ts"]);
  });
});
