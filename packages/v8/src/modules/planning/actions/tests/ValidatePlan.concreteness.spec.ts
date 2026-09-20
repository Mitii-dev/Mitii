import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION } from "../../constants";
import type { PlanArtifact, PlanningParsedInput } from "../../contracts";
import { validatePlan } from "../ValidatePlan";

function baseInput(
  overrides: Partial<PlanningParsedInput> = {},
): PlanningParsedInput {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: "Plan a thorough payments package change",
    mode: "plan",
    route: "plan",
    planningDepth: "visible",
    explorationDepth: "auto",
    evidence: {
      primaryIntent: "feature",
      secondaryIntents: [],
      scope: "package",
      complexity: "complex",
      risk: "medium",
      clarity: "clear",
      targets: [{ kind: "folder", value: "src/payments", explicit: true }],
      constraints: [],
      requestedOutcomes: ["Add retries"],
      recommendsPlanning: true,
      recommendsVerification: true,
      changeImpact: ["code"],
    },
    budgetTokens: 1_200,
    ...overrides,
  } as PlanningParsedInput;
}

function planWithChange(targetRefs: string[], verification?: string): PlanArtifact {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    objective: "Add retries",
    assumptions: ["Payments package is the change surface"],
    openQuestions: [],
    contextReviewed: [],
    constraints: [],
    dimensions: {
      scope: "package",
      risk: "medium",
      clarity: "clear",
      complexity: "complex",
      changeImpact: ["code"],
    },
    phases: [
      {
        id: "phase-change",
        name: "Change",
        purpose: "Implement",
        steps: [
          {
            id: "step-1",
            intent: "Add retry helper",
            targetRefs,
            actionSummary: "Wire retries into the client",
            expectedOutcome: "Retries work",
            verification,
            riskLevel: "low",
          },
        ],
        dependencies: [],
        successCriteria: ["Retries land"],
      },
      {
        id: "phase-verify",
        name: "Verify",
        purpose: "Prove",
        steps: [
          {
            id: "step-verify",
            intent: "Run tests",
            targetRefs: [],
            actionSummary: "Run package tests",
            expectedOutcome: "Tests pass",
            riskLevel: "low",
          },
        ],
        dependencies: ["phase-change"],
        successCriteria: ["Green"],
      },
    ],
    risks: [],
    alternatives: [],
    verification: { checks: ["pnpm test"], manualQa: [], commands: ["pnpm test"] },
    approvalRequired: false,
    processHintsApplied: [],
  };
}

describe("validatePlan concreteness", () => {
  it("blocks Plan-mode Change steps with only vague targets", () => {
    const result = validatePlan({
      plan: planWithChange(["relevant files"], "pnpm test"),
      input: baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add retries",
          filesRead: [
            { path: "src/payments/client.ts", reason: "read" },
            { path: "src/payments/retry.ts", reason: "read" },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "src/payments/client.ts",
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
      }),
      strategy: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "test",
        skipDiscover: true,
        useBuildEvidence: false,
      },
    });
    expect(result.ok).toBe(false);
    expect(result.reasonCodes).toContain("plan_steps_vague_targets");
    expect(result.reasonCodes).toContain("plan_blocked_invalid");
  });

  it("accepts concrete path targets and records concreteness", () => {
    const result = validatePlan({
      plan: planWithChange(["src/payments/client.ts"], "pnpm test"),
      input: baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Add retries",
          filesRead: [
            { path: "src/payments/client.ts", reason: "read" },
            { path: "src/payments/retry.ts", reason: "read" },
          ],
          targets: [],
          proposedChangeSurfaces: [
            {
              path: "src/payments/client.ts",
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
      }),
      strategy: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "test",
        skipDiscover: true,
        useBuildEvidence: false,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCodes).toContain("plan_steps_concrete");
    expect(result.plan.phases[0]?.steps[0]?.targetRefs).toEqual([
      "src/payments/client.ts",
    ]);
  });

  it("skips concreteness gate for thin discovery open-question plans", () => {
    const result = validatePlan({
      plan: planWithChange([], undefined),
      input: baseInput({
        discoveryBrief: {
          schemaVersion: 1,
          objective: "Clarify",
          filesRead: [],
          targets: [],
          proposedChangeSurfaces: [],
          discoveredConstraints: [],
          verificationHints: [],
          openQuestions: ["Which files?"],
          confidence: "low",
        },
      }),
      strategy: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "thin",
        skipDiscover: true,
        useBuildEvidence: false,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.reasonCodes).not.toContain("plan_steps_concrete");
  });
});
