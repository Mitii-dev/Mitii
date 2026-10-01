import { describe, expect, it } from "vitest";

import {
  selectUserFacingLoopAnswer,
  synthesizeFallbackAnswer,
} from "./isIncompleteAssistantTurn";
import { resolveLoopTurnOutcome } from "./resolveLoopTurnOutcome";

describe("empty answer hardening (diagnose thrash / answerChars:0)", () => {
  it("selectUserFacingLoopAnswer never returns blank for empty loop stops", () => {
    const answer = selectUserFacingLoopAnswer({
      loopAnswer: "",
      changedFiles: [],
    });
    expect(answer.trim().length).toBeGreaterThan(0);
    expect(answer).toMatch(/stopped without a complete final answer/i);
  });

  it("hides unfinished investigation dumps but still yields a fallback", () => {
    const dump = [
      "I looked at SettingsSidebar and ArchitectureBoundary.",
      "The failing tests mention path resolution and grant scopes.",
      "But first, let me check the decision policy resolver next.",
    ].join(" ");
    const answer = selectUserFacingLoopAnswer({
      loopAnswer: dump,
      changedFiles: [],
    });
    expect(answer.trim().length).toBeGreaterThan(0);
    expect(answer).not.toMatch(/let me check the decision policy/i);
  });

  it("synthesizeFallbackAnswer stays non-empty with no prior and no files", () => {
    expect(
      synthesizeFallbackAnswer({ changedFiles: [] }).trim().length,
    ).toBeGreaterThan(0);
  });

  it("resolveLoopTurnOutcome recovers empty text-only stops before fallback", () => {
    const first = resolveLoopTurnOutcome({
      route: "diagnose",
      maximumWorkspaceEffect: "read",
      primaryTaskIntent: "question",
      toolCallCount: 0,
      changedFileCount: 0,
      content: "",
      finishReason: "stop",
      truncated: false,
      fileReadCalls: 4,
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 0,
      },
      thresholds: {
        maxIncompleteAnswerRecoveries: 2,
        maxUnfulfilledExecuteRecoveries: 2,
      },
    });
    expect(first.disposition).toBe("recover_incomplete_narration");
    expect(first.reasonCode).toBe("incomplete_answer_recovered");

    const exhausted = resolveLoopTurnOutcome({
      route: "diagnose",
      maximumWorkspaceEffect: "read",
      primaryTaskIntent: "question",
      toolCallCount: 0,
      changedFileCount: 0,
      content: "",
      finishReason: "stop",
      truncated: false,
      fileReadCalls: 4,
      recoveries: {
        truncation: 0,
        incompleteAnswer: 2,
        unfulfilledExecute: 0,
      },
      thresholds: {
        maxIncompleteAnswerRecoveries: 2,
        maxUnfulfilledExecuteRecoveries: 2,
      },
    });
    expect(exhausted.disposition).toBe("complete_answer");
    expect(exhausted.reasonCode).toBe("incomplete_answer_fallback");
  });

  it("resolveLoopTurnOutcome recovers unfinished investigation narration", () => {
    const content =
      "Found TS2307 in settings. But first, let me check ArchitectureBoundary next.";
    const outcome = resolveLoopTurnOutcome({
      route: "diagnose",
      maximumWorkspaceEffect: "read",
      primaryTaskIntent: "question",
      toolCallCount: 0,
      changedFileCount: 0,
      content,
      finishReason: "stop",
      truncated: false,
      fileReadCalls: 8,
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 0,
      },
      thresholds: {
        maxIncompleteAnswerRecoveries: 2,
        maxUnfulfilledExecuteRecoveries: 2,
      },
    });
    expect(outcome.disposition).toBe("recover_incomplete_narration");
  });
});
