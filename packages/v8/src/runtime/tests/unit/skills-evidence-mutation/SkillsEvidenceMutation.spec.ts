import { describe, expect, it, vi } from "vitest";

import {
  MEDIUM_PLANNING_SKILL_ID,
  resolvePreferredSkillIdsForRun,
  selectSkillsForEnrichment,
} from "../../../helpers/skills";
import {
  bindBudgetConsumptionSnapshot,
  buildEvidenceExhaustedTerminalOutcome,
  isIllegalEvidencePhaseTransition,
  shouldOfferContinueAfterEvidenceExhaustion,
  shouldStripDiscoveryAfterEvidenceExhaustion,
} from "../../../helpers/evidence-rail";
import {
  SHELL_MUTATION_MANIFEST_PATHS,
  applySucceededMutationSideEffects,
} from "../../../helpers/mutation-cache";

describe("skills helpers", () => {
  it("prefers medium-planning for medium plan/execute", () => {
    expect(
      resolvePreferredSkillIdsForRun({ taskSize: "medium", route: "execute" }),
    ).toEqual([MEDIUM_PLANNING_SKILL_ID]);
    expect(
      resolvePreferredSkillIdsForRun({ taskSize: "small", route: "execute" }),
    ).toEqual([]);
  });

  it("skips enrichment when skills port is absent", async () => {
    const reasonCodes: string[] = [];
    const result = await selectSkillsForEnrichment({
      ports: {
        skills: undefined,
        emitStage: vi.fn(),
        emit: vi.fn(),
        isoNow: () => "2020-01-01T00:00:00.000Z",
      },
      runId: "run-1",
      input: {} as never,
      windowPolicy: {
        skills: { budgetTokens: 1000, maxSkills: 3 },
        contextWindowTokens: 32_000,
      } as never,
      reasonCodes: reasonCodes as never,
      warnings: [],
      envelope: { message: "fix it", mode: "agent" } as never,
      understanding: { taskAnalysis: { taskSize: "medium" } } as never,
      decision: { route: "execute" } as never,
      contextPaths: [],
      injectSkillCatalogL1: false,
      pushSkillWarnings: false,
    });
    expect(reasonCodes).toContain("skills_skipped");
    expect(result.selectedSkills).toBeUndefined();
  });

  it("selects skills via port and emits ready", async () => {
    const emit = vi.fn();
    const emitStage = vi.fn();
    const reasonCodes: string[] = [];
    const result = await selectSkillsForEnrichment({
      ports: {
        skills: {
          select: async () =>
            ({
              instructions: [
                {
                  id: "s1",
                  title: "Skill",
                  content: "body",
                  priority: 1,
                },
              ],
              omissions: [],
              warnings: [],
              status: "ok",
              requiredCount: 0,
              matchedCount: 1,
            }) as never,
        },
        emitStage,
        emit,
        isoNow: () => "2020-01-01T00:00:00.000Z",
      },
      runId: "run-1",
      input: {} as never,
      windowPolicy: {
        skills: { budgetTokens: 1000, maxSkills: 3 },
        contextWindowTokens: 128_000,
      } as never,
      reasonCodes: reasonCodes as never,
      warnings: [],
      envelope: { message: "implement feature", mode: "agent" } as never,
      understanding: {
        intent: {
          classification: {
            primaryTaskIntent: "feature",
            secondaryTaskIntents: [],
            taskHints: {},
          },
        },
        taskAnalysis: {
          taskSize: "medium",
          targets: [],
          scope: "package",
          complexity: "medium",
          risk: "low",
          recommendsPlanning: false,
          recommendsVerification: true,
        },
      } as never,
      decision: { route: "execute" } as never,
      contextPaths: ["src/a.ts"],
      injectSkillCatalogL1: false,
      pushSkillWarnings: false,
    });
    expect(reasonCodes).toContain("skills_selected");
    expect(result.selectedSkills?.[0]?.id).toBe("s1");
    expect(emitStage).toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({ type: "skills_ready", runId: "run-1" }),
    );
  });
});

describe("evidence-rail helpers", () => {
  it("never offers continue after exhaustion and strips discovery", () => {
    expect(shouldOfferContinueAfterEvidenceExhaustion()).toBe(false);
    expect(
      shouldStripDiscoveryAfterEvidenceExhaustion({
        reasonCodes: ["evidence_recovery_exhausted_terminal"],
      }),
    ).toBe(true);
    expect(isIllegalEvidencePhaseTransition("exhausted", "binding")).toBe(
      true,
    );
  });

  it("builds exhausted terminal outcome + bind snapshot", () => {
    const outcome = buildEvidenceExhaustedTerminalOutcome({
      reason: "recovery_exhausted",
    });
    expect(outcome.kind).toBe("failed");
    expect(outcome.error.code).toBe("evidence_exhausted");
    expect(outcome.reasonCodesToPush).toContain(
      "evidence_recovery_exhausted_terminal",
    );
    expect(
      bindBudgetConsumptionSnapshot({
        maxTurns: 1,
        maxPaths: 2,
        maxNudges: 3,
        recoveryTurns: 4,
        recoveryPaths: 5,
        nudgesUsed: 6,
        recoveryUsed: true,
        readonlyTurnsOnStep: 7,
      }).exhausted,
    ).toBe(true);
  });
});

describe("mutation-cache helpers", () => {
  it("invalidates path-aware cache on checkpoint mutation", () => {
    const invalidateContent = vi.fn();
    const invalidatePaths = vi.fn();
    const reasonCodes: string[] = [];
    const mutationCheckpointIds: string[] = [];
    const changedFiles: string[] = [];
    applySucceededMutationSideEffects({
      toolName: "apply_patch",
      output: { checkpointId: "cp1", changedFiles: ["src/a.ts"] },
      mutationCheckpointIds,
      changedFiles,
      toolCache: { invalidateContent },
      readLedger: { invalidatePaths, clear: vi.fn() },
      reasonCodes: reasonCodes as never,
    });
    expect(mutationCheckpointIds).toEqual(["cp1"]);
    expect(changedFiles).toEqual(["src/a.ts"]);
    expect(reasonCodes).toContain("mutation_applied");
    expect(invalidateContent).toHaveBeenCalledWith(["src/a.ts"]);
    expect(invalidatePaths).toHaveBeenCalledWith(["src/a.ts"]);
  });

  it("full-wipes on shell run_command mutation", () => {
    const invalidateContent = vi.fn();
    const clear = vi.fn();
    const reasonCodes: string[] = [];
    applySucceededMutationSideEffects({
      toolName: "run_command",
      output: undefined,
      mutationCheckpointIds: [],
      changedFiles: [],
      toolCache: { invalidateContent },
      readLedger: { invalidatePaths: vi.fn(), clear },
      reasonCodes: reasonCodes as never,
    });
    expect(reasonCodes).toContain("shell_mutation_cache_invalidated");
    expect(invalidateContent).toHaveBeenCalledWith();
    expect(clear).toHaveBeenCalled();
    expect(SHELL_MUTATION_MANIFEST_PATHS).toContain("package.json");
  });
});
