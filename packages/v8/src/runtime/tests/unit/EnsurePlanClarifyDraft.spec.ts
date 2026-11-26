import { describe, expect, it } from "vitest";

import { ensurePlanClarifyDraft } from "../../helpers/plan-discovery/EnsurePlanClarifyDraft";
import type { PlanningParsedInput } from "../../../modules/planning";

function baseInput(): PlanningParsedInput {
  return {
    schemaVersion: 1,
    query: "Harden the full test suite across devices",
    evidence: {
      schemaVersion: 1,
      clarity: "clear",
      taskSize: "large",
      complexity: "complex",
      scope: "repo",
      risk: "medium",
      recommendsPlanning: true,
      recommendsRepositoryDiscovery: true,
      targets: [],
      requestedOutcomes: [],
    },
    planningDepth: "visible",
  } as PlanningParsedInput;
}

describe("ensurePlanClarifyDraft", () => {
  it("keeps an existing draft", () => {
    const existing = {
      schemaVersion: 1 as const,
      findings: ["a"],
      scopeOptions: [
        {
          id: "outcome:scope-a-focused",
          label: "A) Focused",
          detail: "x",
        },
      ],
    };
    expect(
      ensurePlanClarifyDraft({
        strategy: {
          schemaVersion: 1,
          strategy: "clarify",
          rationale: "test",
          confidence: 0.9,
        },
        clarifyDraft: existing,
        planningInput: baseInput(),
      }),
    ).toBe(existing);
  });

  it("synthesizes fallback when clarify strategy lacks a draft", () => {
    const draft = ensurePlanClarifyDraft({
      strategy: {
        schemaVersion: 1,
        strategy: "clarify",
        rationale: "insufficient discovery",
        confidence: 0.9,
      },
      clarifyDraft: undefined,
      planningInput: baseInput(),
    });
    expect(draft?.scopeOptions.length).toBeGreaterThanOrEqual(2);
    expect(draft?.scopeOptions[0]?.id).toMatch(/^outcome:scope-/);
  });

  it("does not synthesize for concrete strategies", () => {
    expect(
      ensurePlanClarifyDraft({
        strategy: {
          schemaVersion: 1,
          strategy: "discover_and_plan",
          rationale: "ok",
          confidence: 0.8,
        },
        clarifyDraft: undefined,
        planningInput: baseInput(),
      }),
    ).toBeUndefined();
  });

  it("synthesizes for campaign phase-lock after a concrete plan", () => {
    const draft = ensurePlanClarifyDraft({
      strategy: {
        schemaVersion: 1,
        strategy: "discover_and_plan",
        rationale: "ok",
        confidence: 0.8,
      },
      clarifyDraft: undefined,
      planningInput: baseInput(),
      forceForCampaignPhaseLock: true,
    });
    expect(draft?.scopeOptions.length).toBeGreaterThanOrEqual(2);
  });
});
