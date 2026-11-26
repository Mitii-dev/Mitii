import { describe, expect, it } from "vitest";

import { buildOutputTruncationRecovery } from "../../../helpers/loop-rails";

describe("buildOutputTruncationRecovery", () => {
  it("returns null when finishReason is not truncated", () => {
    expect(
      buildOutputTruncationRecovery({
        finishReason: "stop",
        content: "done",
        toolCalls: [],
        recoveryAttempt: 0,
      }),
    ).toBeNull();
  });

  it("plans tool_call recovery for incomplete apply_patch args", () => {
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: "applying patch",
      toolCalls: [
        {
          id: "1",
          name: "apply_patch",
          arguments: "{",
        },
      ],
      recoveryAttempt: 0,
    });
    expect(plan?.shouldRecover).toBe(true);
    expect(plan?.recoveryKind).toBe("tool_call");
    expect(plan?.incompleteToolCalls).toHaveLength(1);
  });

  it("plans text_continuation for truncated text-only turns", () => {
    const plan = buildOutputTruncationRecovery({
      finishReason: "length",
      content: "Here is a long answer that was cut off mid-sent",
      toolCalls: [],
      recoveryAttempt: 0,
    });
    expect(plan?.shouldRecover).toBe(true);
    expect(plan?.recoveryKind).toBe("text_continuation");
  });
});
