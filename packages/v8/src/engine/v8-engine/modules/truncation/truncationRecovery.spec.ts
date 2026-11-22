import { describe, expect, it } from "vitest";

import {
  decideTruncationRecovery,
  truncationWarningMessage,
} from "./index";
import { V8_ENGINE_THRESHOLDS } from "../../policy";

describe("decideTruncationRecovery", () => {
  it("resets truncation counter when a complete tool turn lands", () => {
    const decision = decideTruncationRecovery({
      finishReason: "length",
      hasToolCalls: true,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 2,
      maxTruncationRecoveries: V8_ENGINE_THRESHOLDS.maxTruncationRecoveries,
    });
    expect(decision).toEqual({
      kind: "none",
      shouldRecover: false,
      resetCounter: true,
    });
  });

  it("uses reasoning_abort without burning length recoveries", () => {
    const decision = decideTruncationRecovery({
      finishReason: "stop",
      reasoningBudgetExceeded: true,
      hasToolCalls: false,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 0,
      maxTruncationRecoveries: V8_ENGINE_THRESHOLDS.maxTruncationRecoveries,
      requireMutation: true,
    });
    expect(decision.kind).toBe("reasoning_abort");
    expect(decision.shouldRecover).toBe(true);
    expect(decision.countReasoningAbort).toBe(true);
    expect(decision.message).toContain("reasoning budget");
    expect(decision.message).not.toMatch(/output token limit/i);
    expect(
      truncationWarningMessage({ reasoningBudgetExceeded: true }),
    ).toContain("not an output-token limit");
  });

  it("stops recovering after maxReasoningAbortRecoveries", () => {
    const exhausted = decideTruncationRecovery({
      finishReason: "reasoning_budget",
      reasoningBudgetExceeded: true,
      hasToolCalls: false,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 0,
      maxTruncationRecoveries: 3,
      reasoningAbortRecoveriesUsed: 2,
      maxReasoningAbortRecoveries: 2,
      requireMutation: true,
    });
    expect(exhausted.kind).toBe("reasoning_abort");
    expect(exhausted.shouldRecover).toBe(false);
  });

  it("recovers truncated text until the max, then stops", () => {
    const recovering = decideTruncationRecovery({
      finishReason: "length",
      hasToolCalls: false,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 0,
      maxTruncationRecoveries: 3,
    });
    expect(recovering.kind).toBe("text_continuation");
    expect(recovering.shouldRecover).toBe(true);

    const exhausted = decideTruncationRecovery({
      finishReason: "length",
      hasToolCalls: false,
      incompleteToolCalls: false,
      truncationRecoveriesUsed: 3,
      maxTruncationRecoveries: 3,
    });
    expect(exhausted.shouldRecover).toBe(false);
  });

  it("prefers smaller tool batches when truncated mid-tool or mutation required", () => {
    const decision = decideTruncationRecovery({
      finishReason: "length",
      hasToolCalls: true,
      incompleteToolCalls: true,
      truncationRecoveriesUsed: 1,
      maxTruncationRecoveries: 3,
      requireMutation: true,
    });
    expect(decision.kind).toBe("tool_call");
    expect(decision.message).toContain("smaller apply_patch");
  });
});
