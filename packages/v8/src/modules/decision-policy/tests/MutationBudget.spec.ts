import { describe, expect, it } from "vitest";

import { DecisionPolicyPipeline } from "../index";
import { MUTATION_BUDGET_PROFILES } from "../policy";
import { createInput, createUnderstanding } from "./fixtures/decisionCases";
import { resolveMutationBudget } from "../actions/ResolveMutationBudget";

describe("ResolveMutationBudget", () => {
  it("selects relaxed for simple localized tasks", () => {
    const result = resolveMutationBudget({
      understanding: createUnderstanding({
        taskAnalysis: {
          scope: "single_location",
          complexity: "simple",
          estimatedFilesAffected: { minimum: 1, maximum: 1 },
          recommendsPlanning: false,
        },
      }),
    });

    expect(result.profile).toBe("relaxed");
    expect(result.mutationBudget).toEqual(MUTATION_BUDGET_PROFILES.relaxed);
    expect(result.reasonCodes).toContain("mutation_budget_relaxed");
  });

  it("selects tight for large multi-file or high-complexity work", () => {
    const large = resolveMutationBudget({
      understanding: createUnderstanding({
        taskAnalysis: {
          scope: "multi_file",
          complexity: "complex",
          estimatedFilesAffected: { minimum: 10, maximum: 30 },
          recommendsPlanning: false,
        },
      }),
    });
    expect(large.profile).toBe("tight");
    expect(large.reasonCodes).toContain("mutation_budget_tight");

    const planning = resolveMutationBudget({
      understanding: createUnderstanding({
        taskAnalysis: {
          scope: "package",
          complexity: "moderate",
          estimatedFilesAffected: { minimum: 3, maximum: 6 },
          recommendsPlanning: true,
        },
      }),
    });
    expect(planning.profile).toBe("tight");
  });

  it("selects standard for moderate execute work", () => {
    const result = resolveMutationBudget({
      understanding: createUnderstanding({
        taskAnalysis: {
          scope: "multi_file",
          complexity: "moderate",
          estimatedFilesAffected: { minimum: 2, maximum: 4 },
          recommendsPlanning: false,
        },
      }),
    });

    expect(result.profile).toBe("standard");
    expect(result.mutationBudget).toEqual(MUTATION_BUDGET_PROFILES.standard);
    expect(result.reasonCodes).toContain("mutation_budget_standard");
  });

  it("takes the tighter of profile and window mutation caps", () => {
    const result = resolveMutationBudget({
      understanding: createUnderstanding({
        taskAnalysis: {
          scope: "single_location",
          complexity: "simple",
          estimatedFilesAffected: { minimum: 1, maximum: 1 },
          recommendsPlanning: false,
        },
      }),
      windowPolicy: {
        mutation: {
          maxPatchesPerCall: 3,
          maxUniqueFilesPerCall: 2,
          maxPatchPayloadCharacters: 8_000,
          preferredBatchSize: 1,
          requireBatchedExecution: true,
        },
      } as never,
    });

    expect(result.profile).toBe("relaxed");
    expect(result.mutationBudget.maxPatchesPerCall).toBe(3);
    expect(result.mutationBudget.maxUniqueFilesPerCall).toBe(2);
    expect(result.mutationBudget.maxPatchPayloadCharacters).toBe(8_000);
    expect(result.mutationBudget.preferredBatchSize).toBe(1);
    expect(result.mutationBudget.requireBatchedExecution).toBe(true);
  });
});

describe("DecisionPolicyPipeline mutation budget", () => {
  it("attaches mutationBudget on write grants and omits it for read-only", () => {
    const pipeline = new DecisionPolicyPipeline();

    const write = pipeline.decide(
      createInput({
        mode: "agent",
        message: "Fix null checks across the auth package",
        understanding: createUnderstanding({
          primaryTaskIntent: "bugfix",
          interactionIntent: "act",
          taskAnalysis: {
            scope: "package",
            complexity: "complex",
            estimatedFilesAffected: { minimum: 8, maximum: 20 },
            recommendsPlanning: true,
            recommendsRepositoryDiscovery: true,
          },
        }),
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "st_1" },
          readiness: "ready",
        },
      }),
    );

    expect(write.toolGrant.maximumWorkspaceEffect).toBe("write");
    expect(write.toolGrant.mutationBudget).toEqual(
      MUTATION_BUDGET_PROFILES.tight,
    );
    expect(write.reasonCodes).toContain("mutation_budget_tight");

    const ask = pipeline.decide(
      createInput({
        mode: "ask",
        message: "What does src/util.ts do?",
        understanding: createUnderstanding({
          primaryTaskIntent: "question",
          interactionIntent: "question",
          taskAnalysis: {
            scope: "single_location",
            complexity: "simple",
            recommendsRepositoryDiscovery: true,
          },
        }),
        repositoryState: {
          reference: { workspaceId: "ws_1", stateToken: "st_1" },
          readiness: "ready",
        },
      }),
    );

    expect(ask.toolGrant.maximumWorkspaceEffect).toBe("read");
    expect(ask.toolGrant.mutationBudget).toBeUndefined();
  });
});
