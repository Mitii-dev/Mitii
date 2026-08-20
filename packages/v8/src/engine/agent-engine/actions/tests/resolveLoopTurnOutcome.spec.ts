import { describe, expect, it } from "vitest";

import { resolveLoopTurnOutcome, isUnfulfilledExecute } from "../resolveLoopTurnOutcome";
import { isDegenerateRepeatedAnswer } from "../isIncompleteAssistantTurn";

describe("resolveLoopTurnOutcome", () => {
  it("recovers execute+write+bugfix text-only turns as unfulfilled", () => {
    const outcome = resolveLoopTurnOutcome({
      route: "execute",
      maximumWorkspaceEffect: "write",
      primaryTaskIntent: "bugfix",
      toolCallCount: 0,
      changedFileCount: 0,
      content:
        "Now I have a clear picture. Let me analyze the TypeScript errors:\n1. field should not be string.",
      finishReason: "stop",
      truncated: false,
      mutationBudget: {
        maxPatchesPerCall: 8,
        maxUniqueFilesPerCall: 5,
        maxPatchPayloadCharacters: 24_000,
        preferredBatchSize: 3,
        requireBatchedExecution: false,
      },
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 0,
      },
    });

    expect(outcome.disposition).toBe("recover_unfulfilled_execute");
    expect(outcome.reasonCode).toBe("unfulfilled_execute_recovered");
    expect(outcome.recoveryMessage).toContain("apply_patch");
    expect(outcome.recoveryMessage).toContain("working-set");
  });

  it("exhausts unfulfilled execute after the recovery budget", () => {
    const outcome = resolveLoopTurnOutcome({
      route: "execute",
      maximumWorkspaceEffect: "write",
      primaryTaskIntent: "bugfix",
      toolCallCount: 0,
      changedFileCount: 0,
      content: "Here are all the remaining TypeScript errors.",
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 1,
      },
    });

    expect(outcome.disposition).toBe("complete_answer");
    expect(outcome.reasonCode).toBe("unfulfilled_execute_exhausted");
  });

  it("does not force patches on repository_answer analysis", () => {
    const outcome = resolveLoopTurnOutcome({
      route: "repository_answer",
      maximumWorkspaceEffect: "read",
      primaryTaskIntent: "question",
      toolCallCount: 0,
      changedFileCount: 0,
      content: "The parser returns null when the token stream is empty.",
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 0,
      },
    });

    expect(outcome.disposition).toBe("complete_answer");
    expect(isUnfulfilledExecute({
      route: "repository_answer",
      maximumWorkspaceEffect: "read",
      primaryTaskIntent: "question",
      toolCallCount: 0,
      changedFileCount: 0,
      content: "The parser returns null.",
    })).toBe(false);
  });

  it("detects degenerate repeating numbered diagnoses", () => {
    const lines = Array.from({ length: 24 }, (_, index) => {
      const name = ["field-text-type.ts", "field-radio-type.ts", "common-types.ts"][
        index % 3
      ];
      return `${index + 1}. **${name}** - \`field: string\` but the component accesses \`field.field\` which is invalid after the config-object change.`;
    });
    const content = `Now I have a clear picture of the remaining TypeScript errors.\n\n${lines.join("\n")}\n`;
    expect(content.length).toBeGreaterThan(2_000);
    expect(isDegenerateRepeatedAnswer(content)).toBe(true);
  });
});
