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
        unfulfilledExecute: 2,
      },
    });

    expect(outcome.disposition).toBe("complete_answer");
    expect(outcome.reasonCode).toBe("unfulfilled_execute_exhausted");
  });

  it("treats a clear mutation blocker as a fulfilled text-only stop", () => {
    const blocker =
      "Blocker: cannot fix this with a workspace edit. Stripo.init requires API credentials and config params that are not in this repository.";
    expect(
      isUnfulfilledExecute({
        route: "execute",
        maximumWorkspaceEffect: "write",
        primaryTaskIntent: "bugfix",
        toolCallCount: 0,
        changedFileCount: 0,
        content: blocker,
      }),
    ).toBe(false);

    const outcome = resolveLoopTurnOutcome({
      route: "execute",
      maximumWorkspaceEffect: "write",
      primaryTaskIntent: "bugfix",
      toolCallCount: 0,
      changedFileCount: 0,
      content: blocker,
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 0,
      },
    });
    expect(outcome.disposition).toBe("complete_answer");
    expect(outcome.reasonCode).toBe("answer_produced");
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

  it("treats docs execute+write text-only as unfulfilled", () => {
    expect(
      isUnfulfilledExecute({
        route: "execute",
        maximumWorkspaceEffect: "write",
        primaryTaskIntent: "docs",
        toolCallCount: 0,
        changedFileCount: 0,
        content: "I will document the App Router under docs/routing.md.",
      }),
    ).toBe(true);
  });

  it("treats mutation_execute reason codes as requiring a patch", () => {
    expect(
      isUnfulfilledExecute({
        route: "execute",
        maximumWorkspaceEffect: "write",
        primaryTaskIntent: "question",
        reasonCodes: ["mutation_execute"],
        toolCallCount: 0,
        changedFileCount: 0,
        content: "Change role status to alert in the component.",
      }),
    ).toBe(true);
  });

  it("recovers repository answers that claim missing workspace context", () => {
    const outcome = resolveLoopTurnOutcome({
      route: "repository_answer",
      maximumWorkspaceEffect: "read",
      primaryTaskIntent: "question",
      toolCallCount: 0,
      changedFileCount: 0,
      fileReadCalls: 0,
      content:
        "I don't have any repository files or workspace context available in this conversation, so I can't identify the heading.",
      recoveries: {
        truncation: 0,
        incompleteAnswer: 0,
        unfulfilledExecute: 0,
      },
    });
    expect(outcome.disposition).toBe("recover_incomplete_narration");
    expect(outcome.recoveryMessage).toContain("read_file");
  });
});
