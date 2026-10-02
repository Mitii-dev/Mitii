/**
 * P1 Medium close-loop goldens: skill prefer → discover_and_plan → concrete
 * checklist → bind budgets. Known paths must still discover.
 */
import { describe, expect, it } from "vitest";

import {
  resolvePlanStrategyRules,
} from "../../../modules/planning";
import type { PlanningParsedInput } from "../../../modules/planning";
import { resolvePlanStrategy } from "../../../modules/planning/actions/ResolvePlanStrategy";
import {
  resolvePreferredSkillIdsForRun,
  MEDIUM_PLANNING_SKILL_ID,
} from "../actions/resolvePreferredSkillIds";
import { resolveDiscoveryPassBudget } from "./plan-discovery";
import { resolveMutateReadinessBudget } from "./mutate-readiness";
import {
  ensureConcreteTaskListFromPlan,
  resolveExecutionSeed,
} from "./execution-seed";
import type { PlanArtifact } from "../../../modules/planning";
import type { RequestUnderstandingResult } from "../../../modules/request-understanding";
import { isMutateLockAllowedToolName } from "./mutate-readiness";

function mediumInput(
  overrides: Partial<PlanningParsedInput> = {},
): PlanningParsedInput {
  return {
    schemaVersion: 1,
    query:
      "Add support for retrying failed API requests up to 3 times. Update the implementation and add tests. The API client is in src/api/client.ts. Don't change unrelated API behavior.",
    mode: "agent",
    route: "execute",
    planningDepth: "internal",
    explorationDepth: "auto",
    evidence: {
      primaryIntent: "feature",
      secondaryIntents: [],
      scope: "multi_file",
      complexity: "moderate",
      risk: "medium",
      clarity: "clear",
      taskSize: "medium",
      targets: [
        { kind: "file", value: "src/api/client.ts", explicit: true },
      ],
      constraints: [],
      requestedOutcomes: ["Add retries", "Update tests"],
      recommendsPlanning: true,
      recommendsVerification: true,
    },
    knownPathHints: ["src/api/client.ts"],
    budgetTokens: 4_000,
    maxDiagnosticSteps: 4,
    maxFilesPerBatch: 4,
    ...overrides,
  } as PlanningParsedInput;
}

describe("P1 Medium close-loop goldens", () => {
  it("prefers medium-planning for medium execute (soft)", () => {
    expect(
      resolvePreferredSkillIdsForRun({
        taskSize: "medium",
        route: "execute",
      }),
    ).toEqual([MEDIUM_PLANNING_SKILL_ID]);
  });

  it("forces discover_and_plan for medium even with known path hints", () => {
    const decision = resolvePlanStrategyRules(mediumInput());
    expect(decision.strategy).toBe("discover_and_plan");
    expect(decision.skipDiscover).toBe(false);

    const resolved = resolvePlanStrategy({ input: mediumInput() });
    expect(resolved.reasonCodes).toContain(
      "plan_strategy_medium_bounded_discover",
    );
    expect(resolved.reasonCodes).not.toContain("plan_strategy_known_paths");
  });

  it("sizes discovery and per-step bind envelopes for medium × band", () => {
    const discovery = resolveDiscoveryPassBudget("medium", "standard");
    expect(discovery.maxModelTurns).toBe(4);
    expect(discovery.maxFileReads).toBe(8);

    const bind = resolveMutateReadinessBudget("medium", "standard");
    expect(bind.readonlyTurnsBeforeGate).toBe(3);
    expect(bind.maxEvidencePaths).toBe(8);
    expect(bind.maxEvidenceGateNudgesBeforePatchDemand).toBe(2);
  });

  it("yields a concrete checklist after one seed recovery — never silent invent", () => {
    const hollow: PlanArtifact = {
      schemaVersion: 1,
      objective: "Add retries",
      approvalRequired: false,
      phases: [
        {
          id: "change",
          name: "Change",
          steps: [
            {
              id: "c1",
              intent: "Add retry handling to API client",
              targetRefs: [],
            },
          ],
        },
      ],
    } as PlanArtifact;

    const understanding = {
      taskAnalysis: {
        targets: [
          {
            kind: "file",
            value: "src/api/client.ts",
            explicit: true,
          },
        ],
      },
    } as RequestUnderstandingResult;

    const seed = resolveExecutionSeed({
      userPrompt: mediumInput().query,
      understanding,
    });

    const recovered = ensureConcreteTaskListFromPlan({
      plan: hollow,
      seed,
      allowSeedRecovery: true,
    });
    expect(recovered.concrete).toBe(true);
    expect(recovered.recovered).toBe(true);
    expect(recovered.taskList?.items.some((i) => (i.write?.length ?? 0) > 0)).toBe(
      true,
    );

    const noChange: PlanArtifact = {
      schemaVersion: 1,
      objective: "Vague",
      approvalRequired: false,
      phases: [
        {
          id: "discover",
          name: "Discover",
          steps: [{ id: "d1", intent: "Look around", targetRefs: [] }],
        },
      ],
    } as PlanArtifact;
    const blocked = ensureConcreteTaskListFromPlan({
      plan: noChange,
      seed,
      allowSeedRecovery: true,
    });
    expect(blocked.concrete).toBe(false);
  });

  it("rejects post-READY discovery tools under mutate lock", () => {
    expect(
      isMutateLockAllowedToolName("search_files", { allowTargetedReads: true }),
    ).toBe(false);
    expect(
      isMutateLockAllowedToolName("glob_files", { allowTargetedReads: false }),
    ).toBe(false);
    expect(
      isMutateLockAllowedToolName("apply_patch", { allowTargetedReads: false }),
    ).toBe(true);
  });
});
