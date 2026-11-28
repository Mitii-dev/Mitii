import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION } from "../../../constants";
import type { PlanArtifact, PlanningParsedInput } from "../../../contracts";
import {
  isGenericDiscoverySkeletonPlan,
  looksLikeMultiItemPlanningQuery,
  requiresNonSkeletonDiscoveryDraft,
} from "../../../helpers/discoveryDraftQuality";

function planInput(
  overrides: Partial<PlanningParsedInput> = {},
): PlanningParsedInput {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: "Add a retry helper",
    mode: "plan",
    route: "plan",
    planningDepth: "visible",
    explorationDepth: "auto",
    evidence: {
      primaryIntent: "feature",
      secondaryIntents: [],
      scope: "single_location",
      complexity: "simple",
      risk: "low",
      clarity: "clear",
      targets: [],
      constraints: [],
      requestedOutcomes: ["Add retry"],
      recommendsPlanning: true,
      recommendsVerification: true,
      changeImpact: ["code"],
      taskSize: "small",
    },
    discoveryBrief: {
      schemaVersion: 1,
      objective: "Add retry",
      filesRead: [
        { path: "src/a.ts", reason: "read" },
        { path: "src/b.ts", reason: "read" },
      ],
      targets: [],
      proposedChangeSurfaces: [
        {
          path: "src/a.ts",
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
    budgetTokens: 1_200,
    ...overrides,
  } as PlanningParsedInput;
}

describe("requiresNonSkeletonDiscoveryDraft", () => {
  const discover = {
    schemaVersion: 1 as const,
    strategy: "discover_and_plan" as const,
    rationale: "test",
    skipDiscover: true,
    useBuildEvidence: false,
  };

  it("requires a model draft for medium Plan asks", () => {
    expect(
      requiresNonSkeletonDiscoveryDraft({
        input: planInput({
          evidence: {
            ...planInput().evidence,
            taskSize: "medium",
          },
        }),
        strategy: discover,
      }),
    ).toBe(true);
  });

  it("allows skeleton for small single-surface Plan", () => {
    expect(
      requiresNonSkeletonDiscoveryDraft({
        input: planInput(),
        strategy: discover,
      }),
    ).toBe(false);
  });

  it("allows multi-surface discovery skeletons without a model draft", () => {
    expect(
      requiresNonSkeletonDiscoveryDraft({
        input: planInput({
          discoveryBrief: {
            ...planInput().discoveryBrief!,
            proposedChangeSurfaces: [
              {
                path: "src/a.ts",
                actionHint: "Change",
                riskLevel: "low",
                evidence: "read",
              },
              {
                path: "src/b.ts",
                actionHint: "Change",
                riskLevel: "low",
                evidence: "read",
              },
            ],
          },
        }),
        strategy: discover,
      }),
    ).toBe(false);
  });

  it("requires a model draft for multi-item Plan queries", () => {
    const query = [
      "how many verifiers and what to improve",
      "Follow-up: can you plan for the above implementation",
      "Suggested improvements / gaps",
      "| Area | What |",
      "|------|------|",
      "| Regex | file_matches_regex |",
      "| Schema | json_schema |",
      "| Parallel | parallel verifier |",
    ].join("\n");
    expect(looksLikeMultiItemPlanningQuery(query)).toBe(true);
    expect(
      requiresNonSkeletonDiscoveryDraft({
        input: planInput({ query }),
        strategy: discover,
      }),
    ).toBe(true);
  });
});

describe("isGenericDiscoverySkeletonPlan", () => {
  it("detects single surface-row Change plans", () => {
    const plan: PlanArtifact = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Improve verifiers",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "single_location",
        risk: "low",
        clarity: "clear",
        complexity: "simple",
        changeImpact: ["code"],
      },
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: 'Apply the smallest coherent change set for "Improve verifiers".',
          steps: [
            {
              id: "step-change-surface-1",
              intent: "Change packages/runner/src/verifiers.js",
              targetRefs: ["packages/runner/src/verifiers.js"],
              actionSummary: "read_file packages/runner/src/verifiers.js",
              expectedOutcome: "done",
              riskLevel: "low",
            },
          ],
          dependencies: [],
          successCriteria: [],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: [], manualQa: [], commands: [] },
      approvalRequired: false,
      processHintsApplied: [],
    };
    expect(isGenericDiscoverySkeletonPlan(plan)).toBe(true);
  });

  it("does not flag model-drafted Change steps", () => {
    const plan: PlanArtifact = {
      schemaVersion: PLANNING_SCHEMA_VERSION,
      objective: "Improve verifiers",
      assumptions: [],
      openQuestions: [],
      contextReviewed: [],
      constraints: [],
      dimensions: {
        scope: "package",
        risk: "low",
        clarity: "clear",
        complexity: "moderate",
        changeImpact: ["code"],
      },
      phases: [
        {
          id: "phase-change",
          name: "Change",
          purpose: 'Apply the smallest coherent change set for "Improve verifiers".',
          steps: [
            {
              id: "phase-change-draft-1",
              intent: "Add file_matches_regex verifier",
              targetRefs: ["packages/runner/src/verifiers.js"],
              actionSummary: "Implement regex check.type branch",
              expectedOutcome: "Regex verifier works",
              riskLevel: "low",
            },
          ],
          dependencies: [],
          successCriteria: [],
        },
      ],
      risks: [],
      alternatives: [],
      verification: { checks: ["pnpm test"], manualQa: [], commands: ["pnpm test"] },
      approvalRequired: false,
      processHintsApplied: [],
    };
    expect(isGenericDiscoverySkeletonPlan(plan)).toBe(false);
  });
});
