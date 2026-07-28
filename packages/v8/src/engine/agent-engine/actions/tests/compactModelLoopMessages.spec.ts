import { describe, expect, it } from "vitest";

import { CharacterTokenEstimator } from "../../../../modules/prompt-construction";
import {
  compactModelLoopMessages,
  estimateModelMessagesTokens,
} from "../compactModelLoopMessages";
import type { ModelMessage } from "../../../../modules/model-gateway";

const estimator = new CharacterTokenEstimator();

describe("compactModelLoopMessages", () => {
  it("counts and compacts prior tool call arguments, not only message content", () => {
    const hugeArguments = JSON.stringify({
      path: "src/large.ts",
      oldText: "a".repeat(10_000),
      newText: "b".repeat(10_000),
    });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "fix it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_old",
            name: "apply_patch",
            arguments: hugeArguments,
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_old",
        content: JSON.stringify({
          status: "succeeded",
          output: "x".repeat(6_000),
        }),
      },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_recent",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/large.ts" }),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_recent",
        content: JSON.stringify({ status: "succeeded", output: "ok" }),
      },
    ];

    const before = estimateModelMessagesTokens(messages, estimator);
    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 1_600,
      recentToolMessagesToKeepFull: 1,
      minMessagesToKeep: 4,
    });

    const oldToolCall = result.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === "call_old");
    const recentToolCall = result.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === "call_recent");

    expect(before).toBeGreaterThan(6_000);
    expect(result.compacted).toBe(true);
    expect(result.usedTokens).toBeLessThan(before);
    expect(oldToolCall?.arguments).toContain(
      "previous_completed_tool_call_arguments_omitted",
    );
    expect(recentToolCall?.arguments).toBe(
      JSON.stringify({ path: "src/large.ts" }),
    );
    expect(
      result.messages.find((message) => message.toolCallId === "call_old")
        ?.content.length,
    ).toBeLessThan(1_000);
  });
});
