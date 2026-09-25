import { describe, expect, it } from "vitest";

import {
  DIAGNOSE_ANSWER_NUDGE_MESSAGE,
  answerLockModelRequestFields,
  filterToolsForAnswerLock,
  primaryToolNameIfUniform,
  shouldLockDiagnoseAnswer,
  shouldNudgeDiagnoseAnswer,
  updateRepeatedReadonlyToolTurns,
} from "../../pipeline/diagnoseAnswerLock";
import type { ModelToolDefinition } from "../../../../modules/model-gateway";

describe("diagnoseAnswerLock (BillBuddy 23:34)", () => {
  it("detects a uniform tool-name turn", () => {
    expect(
      primaryToolNameIfUniform([
        { id: "1", name: "read_diagnostics", arguments: {} },
        { id: "2", name: "read_diagnostics", arguments: { path: "a.ts" } },
      ]),
    ).toBe("read_diagnostics");
    expect(
      primaryToolNameIfUniform([
        { id: "1", name: "read_diagnostics", arguments: {} },
        { id: "2", name: "read_file", arguments: { path: "a.ts" } },
      ]),
    ).toBeUndefined();
  });

  it("counts consecutive identical tool turns", () => {
    expect(
      updateRepeatedReadonlyToolTurns({
        previousToolName: undefined,
        previousCount: 0,
        turnToolName: "read_diagnostics",
      }),
    ).toEqual({ toolName: "read_diagnostics", count: 1 });
    expect(
      updateRepeatedReadonlyToolTurns({
        previousToolName: "read_diagnostics",
        previousCount: 2,
        turnToolName: "read_diagnostics",
      }),
    ).toEqual({ toolName: "read_diagnostics", count: 3 });
    expect(
      updateRepeatedReadonlyToolTurns({
        previousToolName: "read_diagnostics",
        previousCount: 3,
        turnToolName: "read_file",
      }),
    ).toEqual({ toolName: "read_file", count: 1 });
  });

  it("nudges once then locks tools after the same diagnostic thrash", () => {
    expect(
      shouldNudgeDiagnoseAnswer({
        mutationRequired: false,
        consecutiveSameToolTurns: 3,
        maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: 3,
        diagnoseAnswerNudges: 0,
        maxDiagnoseAnswerNudges: 1,
      }),
    ).toBe(true);
    expect(
      shouldLockDiagnoseAnswer({
        mutationRequired: false,
        consecutiveSameToolTurns: 3,
        maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: 3,
        diagnoseAnswerNudges: 0,
        maxDiagnoseAnswerNudges: 1,
      }),
    ).toBe(false);
    expect(
      shouldLockDiagnoseAnswer({
        mutationRequired: false,
        consecutiveSameToolTurns: 4,
        maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: 3,
        diagnoseAnswerNudges: 1,
        maxDiagnoseAnswerNudges: 1,
      }),
    ).toBe(true);
    expect(
      shouldNudgeDiagnoseAnswer({
        mutationRequired: true,
        consecutiveSameToolTurns: 10,
        maxRepeatedReadonlyToolTurnsBeforeAnswerNudge: 3,
        diagnoseAnswerNudges: 0,
        maxDiagnoseAnswerNudges: 1,
      }),
    ).toBe(false);
  });

  it("strips tools for answer lock and keeps nudge copy actionable", () => {
    const tools: ModelToolDefinition[] = [
      { name: "read_diagnostics", description: "d", inputSchema: {} },
      { name: "read_file", description: "r", inputSchema: {} },
    ];
    expect(filterToolsForAnswerLock(tools)).toEqual([]);
    expect(answerLockModelRequestFields(tools)).toEqual({
      tools: [],
      toolChoice: "none",
    });
    expect(DIAGNOSE_ANSWER_NUDGE_MESSAGE).toMatch(/Answer the user now/i);
    expect(DIAGNOSE_ANSWER_NUDGE_MESSAGE).toMatch(/typecheck|command output/i);
  });
});
