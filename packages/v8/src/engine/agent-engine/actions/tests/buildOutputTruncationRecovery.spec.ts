import { describe, expect, it } from "vitest";

import {
  buildMutationBudgetInstruction,
  buildOutputTruncationRecovery,
  isCompleteToolCall,
} from "..";
import type { MutationBudget } from "../../../modules/decision-policy";

const tightBudget: MutationBudget = {
  maxPatchesPerCall: 5,
  maxUniqueFilesPerCall: 3,
  maxPatchPayloadCharacters: 16_000,
  preferredBatchSize: 2,
  requireBatchedExecution: true,
};

describe("buildOutputTruncationRecovery", () => {
  it("returns null when finishReason is not length", () => {
    expect(
      buildOutputTruncationRecovery({
        finishReason: "stop",
        content: "done",
        toolCalls: [],
        recoveryAttempt: 0,
      }),
    ).toBeNull();
  });

  it("recovers when truncated apply_patch JSON is incomplete", () => {
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: "",
      toolCalls: [
        {
          id: "c1",
          name: "apply_patch",
          arguments: '{"patches":[{"path":"a.ts","oldText":"x"',
        },
      ],
      mutationBudget: tightBudget,
      recoveryAttempt: 0,
    });

    expect(plan).not.toBeNull();
    expect(plan!.shouldRecover).toBe(true);
    expect(plan!.incompleteToolCalls).toHaveLength(1);
    expect(plan!.recoveryMessage.role).toBe("user");
    expect(plan!.recoveryMessage.content).toContain("smaller batch");
    expect(plan!.recoveryMessage.content).toContain("2 files");
  });

  it("does not recover when truncated apply_patch JSON is complete", () => {
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: "applying…",
      toolCalls: [
        {
          id: "c1",
          name: "apply_patch",
          arguments: JSON.stringify({
            patches: [
              { path: "a.ts", oldText: "a", newText: "A" },
              { path: "b.ts", oldText: "b", newText: "B" },
            ],
          }),
        },
      ],
      mutationBudget: tightBudget,
      recoveryAttempt: 0,
    });

    expect(plan).toBeNull();
  });

  it("stops recovering after max attempts", () => {
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: "",
      toolCalls: [
        {
          id: "c1",
          name: "apply_patch",
          arguments: "{incomplete",
        },
      ],
      recoveryAttempt: 3,
    });
    expect(plan).toBeNull();
  });

  it("does not recover truncated text-only answers", () => {
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: "Here is a long answer that got cut off mid-sent",
      toolCalls: [],
      recoveryAttempt: 0,
    });
    expect(plan).toBeNull();
  });
});

describe("isCompleteToolCall", () => {
  it("rejects empty or invalid JSON", () => {
    expect(isCompleteToolCall({ id: "1", name: "apply_patch", arguments: "" })).toBe(
      false,
    );
    expect(
      isCompleteToolCall({ id: "1", name: "apply_patch", arguments: "{nope" }),
    ).toBe(false);
  });

  it("accepts valid apply_patch payloads", () => {
    expect(
      isCompleteToolCall({
        id: "1",
        name: "apply_patch",
        arguments: JSON.stringify({
          patches: [{ path: "a.ts", oldText: "x", newText: "y" }],
        }),
      }),
    ).toBe(true);
  });
});

describe("buildMutationBudgetInstruction", () => {
  it("returns undefined without budget", () => {
    expect(buildMutationBudgetInstruction(undefined)).toBeUndefined();
  });

  it("embeds hard limits and batch preference", () => {
    const block = buildMutationBudgetInstruction(tightBudget);
    expect(block?.id).toBe("mitii.mutation_budget");
    expect(block?.content).toContain("batched execution");
    expect(block?.content).toContain("≤5 patches");
    expect(block?.content).toContain("≤3 unique files");
  });
});
