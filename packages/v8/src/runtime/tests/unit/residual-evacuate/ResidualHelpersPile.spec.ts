import { describe, expect, it } from "vitest";

import { assembleToolCalls } from "../../../helpers/complete-tool-calls";
import {
  clampTurnMaximumOutputTokens,
  decideWallTimeDeadline,
  resolvePromptCacheClass,
  resolveWallTimeReserveMs,
} from "../../../helpers/budgets";
import {
  resolveAgentEngineThresholds,
  resolveLoopPolicyThresholds,
  shouldNudgeCodeIntelAdoption,
} from "../../../helpers/thresholds";
import {
  estimateStickyMutableChars,
  serializeRecoverabilityWorkingSet,
} from "../../../helpers/working-set";
import {
  buildMissingModuleStubPatches,
  shouldSuspendContinueAfterVerificationAccept,
} from "../../../helpers/verify";
import {
  isLowValueAnswerFollowUp,
  preserveSubstantiveAssistantAnswer,
} from "../../../helpers/loop-turn";
import { buildForcedMutationNudgeMessage } from "../../../helpers/loop-rails/mutation-nudge";
import { buildPlanClarifySuspension } from "../../../helpers/clarification";

describe("residual helpers pile", () => {
  it("resolves agent + loop-policy thresholds", () => {
    const base = resolveAgentEngineThresholds();
    expect(base.maxTruncationRecoveries).toBeGreaterThan(0);
    const loop = resolveLoopPolicyThresholds({ contextWindowTokens: 128_000 });
    expect(loop.thresholds.maxTruncationRecoveries).toBeGreaterThan(0);
    expect(loop.band).toBeTruthy();
  });

  it("assembles streamed tool-call deltas", () => {
    const calls = assembleToolCalls([
      { index: 0, id: "c1", name: "read_file", arguments: '{"path":' },
      { index: 0, arguments: '"src/a.ts"}' },
    ] as never);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe("read_file");
    expect(calls[0]?.arguments).toContain("src/a.ts");
  });

  it("builds missing-module stub patches from cannot-find-module", () => {
    const patches = buildMissingModuleStubPatches({
      diagnostics: [
        {
          path: "src/a.ts",
          severity: "error",
          message: "Cannot find module './missingUtil'",
        },
      ] as never,
    });
    expect(patches.length).toBeGreaterThan(0);
    expect(patches[0]?.oldText).toBe("");
  });

  it("serializes recoverability working set and sticky chars", () => {
    const block = serializeRecoverabilityWorkingSet({
      taskList: {
        schemaVersion: 1,
        source: "agent",
        purpose: "execution",
        items: [{ id: "a", title: "Fix src/a.ts", status: "active" }],
      } as never,
      remindTodoUpdate: true,
    });
    expect(block).toContain("## Checklist");

    const sticky = estimateStickyMutableChars([
      { role: "user", content: "hello" },
      { role: "assistant", content: "world" },
    ] as never);
    expect(sticky.stickyChars).toBeGreaterThan(0);
  });

  it("clamps turn output, wall-time reserve, and prompt cache class", () => {
    expect(
      clampTurnMaximumOutputTokens({
        reservedOutputTokens: 4096,
        contextWindowTokens: 32_000,
        usedInputTokens: 1_000,
      }),
    ).toBeGreaterThanOrEqual(256);
    expect(resolveWallTimeReserveMs(60_000)).toBeGreaterThan(0);
    expect(
      decideWallTimeDeadline({
        remainingMs: 50_000,
        maxWallTimeMs: 60_000,
        mutationApplied: false,
        mutationRequired: true,
        alreadyNudged: false,
      }),
    ).toBe("continue");
    expect(
      resolvePromptCacheClass({ supportsPromptCaching: true, modelCalls: 0 }),
    ).toBe("prompt_cache");
  });

  it("preserves substantive answers and builds forced mutation nudge", () => {
    expect(isLowValueAnswerFollowUp("ok")).toBe(false);
    expect(
      preserveSubstantiveAssistantAnswer(
        "A detailed finding about auth across several modules.",
        "Completed workspace edits.",
      ),
    ).toContain("detailed finding");
    const nudge = buildForcedMutationNudgeMessage({
      diagnostics: [
        { path: "src/a.ts", severity: "error", message: "boom" },
      ] as never,
    });
    expect(nudge.toLowerCase()).toMatch(/apply_patch|patch|mutate/);
  });

  it("keeps verification accept as non-continue and builds plan clarify", () => {
    expect(shouldSuspendContinueAfterVerificationAccept()).toBe(false);
    expect(
      shouldNudgeCodeIntelAdoption({
        allowedTools: ["goto_definition"],
        codeIntelligenceToolIds: ["goto_definition"],
        successfulFileBodyReads: 50,
        codeIntelToolUses: 0,
        nudgesUsed: 0,
      }),
    ).toBe(true);

    const clarify = buildPlanClarifySuspension({
      schemaVersion: 1,
      findings: ["Need scope"],
      scopeOptions: [
        { id: "a", label: "Package only" },
        { id: "b", label: "Whole repo" },
      ],
    });
    expect(clarify.clarificationOptions.length).toBeGreaterThan(0);
    expect(clarify.answer.length).toBeGreaterThan(0);
  });
});
