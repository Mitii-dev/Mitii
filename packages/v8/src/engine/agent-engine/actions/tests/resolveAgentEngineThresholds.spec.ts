import { describe, expect, it } from "vitest";

import { AGENT_ENGINE_THRESHOLDS } from "../../policy";
import {
  resolveAgentEngineThresholds,
  agentEngineThresholdsOverridesSchema,
} from "../resolveAgentEngineThresholds";
import { isExplorationRereadHeavy } from "../isExplorationRereadHeavy";

describe("resolveAgentEngineThresholds", () => {
  it("returns working standards when overrides are omitted", () => {
    expect(resolveAgentEngineThresholds()).toEqual({
      ...AGENT_ENGINE_THRESHOLDS,
    });
  });

  it("merges only provided keys onto standards", () => {
    const resolved = resolveAgentEngineThresholds({
      explorationRereadMinCalls: 24,
      explorationRereadRatio: 3,
      maxExplorationStallNudges: 3,
      maxRejectedMutationRecoveries: 5,
    });
    expect(resolved.explorationRereadMinCalls).toBe(24);
    expect(resolved.explorationRereadRatio).toBe(3);
    expect(resolved.maxExplorationStallNudges).toBe(3);
    expect(resolved.maxRejectedMutationRecoveries).toBe(5);
    expect(resolved.maxUnfulfilledExecuteRecoveries).toBe(
      AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries,
    );
    expect(resolved.maxReadOnlyToolTurnsBeforeMutationNudge).toBe(
      AGENT_ENGINE_THRESHOLDS.maxReadOnlyToolTurnsBeforeMutationNudge,
    );
  });

  it("keeps rejected-mutation recoveries independent of unfulfilled-execute", () => {
    expect(AGENT_ENGINE_THRESHOLDS.maxRejectedMutationRecoveries).toBe(3);
    expect(AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries).toBe(2);
    expect(
      AGENT_ENGINE_THRESHOLDS.maxRejectedMutationRecoveries,
    ).toBeGreaterThan(AGENT_ENGINE_THRESHOLDS.maxUnfulfilledExecuteRecoveries);
  });

  it("rejects invalid override values", () => {
    expect(() =>
      agentEngineThresholdsOverridesSchema.parse({
        explorationRereadMinCalls: 0,
      }),
    ).toThrow();
  });

  it("allows zero recovery overrides to disable nudges", () => {
    const resolved = resolveAgentEngineThresholds({
      maxRejectedMutationRecoveries: 0,
      maxUnfulfilledExecuteRecoveries: 0,
      maxTruncationRecoveries: 0,
    });
    expect(resolved.maxRejectedMutationRecoveries).toBe(0);
    expect(resolved.maxUnfulfilledExecuteRecoveries).toBe(0);
    expect(resolved.maxTruncationRecoveries).toBe(0);
  });
});

describe("isExplorationRereadHeavy with overrides", () => {
  it("uses injected thresholds instead of standards", () => {
    const snapshot = { fileReadCalls: 9, uniqueFilePathsTouched: 5 };
    expect(isExplorationRereadHeavy(snapshot)).toBe(false);
    expect(
      isExplorationRereadHeavy(snapshot, {
        explorationRereadMinCalls: 8,
        explorationRereadRatio: 2,
      }),
    ).toBe(false);
    expect(
      isExplorationRereadHeavy(snapshot, {
        explorationRereadMinCalls: 8,
        explorationRereadRatio: 1.5,
      }),
    ).toBe(true);
  });

  it("stays quiet below a raised min-call override", () => {
    expect(
      isExplorationRereadHeavy(
        { fileReadCalls: 12, uniqueFilePathsTouched: 1 },
        {
          explorationRereadMinCalls: 16,
          explorationRereadRatio: 2,
        },
      ),
    ).toBe(false);
  });
});
