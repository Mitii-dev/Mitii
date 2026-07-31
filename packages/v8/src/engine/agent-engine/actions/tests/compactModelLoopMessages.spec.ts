import { describe, expect, it } from "vitest";

import { CharacterTokenEstimator } from "../../../../modules/prompt-construction";
import {
  compactModelLoopMessages,
  estimateModelMessagesTokens,
  resolveCompactionPressure,
  resolveCompactionThresholds,
} from "../compactModelLoopMessages";
import type { ModelMessage } from "../../../../modules/model-gateway";

const estimator = new CharacterTokenEstimator();

describe("compactModelLoopMessages", () => {
  it("reports warn pressure before auto compaction changes history", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "x".repeat(2_900) },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 1_000,
    });

    expect(result.pressure).toBe("warn");
    expect(result.compacted).toBe(false);
    expect(result.messages).toEqual(messages);
    expect(result.thresholds).toEqual({
      warnTokens: 700,
      autoTokens: 800,
      hardTokens: 920,
    });
  });

  it("starts auto compaction at the ladder threshold", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "fix it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_old",
            name: "search_files",
            arguments: JSON.stringify({ query: "x".repeat(7_000) }),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_old",
        content: "y".repeat(1_200),
      },
      { role: "assistant", content: "next" },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 2_400,
      recentToolMessagesToKeepFull: 0,
      minMessagesToKeep: 4,
    });

    expect(result.pressure).toBe("auto");
    expect(result.compacted).toBe(true);
    expect(result.usedTokens).toBeLessThan(
      estimateModelMessagesTokens(messages, estimator),
    );
  });

  it("summarizes dropped turns and reinjects memory on hard pressure", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "old context ".repeat(200) },
      { role: "assistant", content: "old answer ".repeat(200) },
      { role: "user", content: "recent ask" },
      { role: "assistant", content: "recent answer" },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 400,
      minMessagesToKeep: 2,
      memoryFacts: [{ id: "m1", content: "Prefer pnpm." }],
    });

    expect(result.pressure).toBe("hard");
    expect(result.compacted).toBe(true);
    expect(result.summarizedDroppedTurns).toBe(true);
    expect(
      result.messages.some((message) =>
        message.content.includes("compacted prior context"),
      ),
    ).toBe(true);
    expect(result.reinjectedMemory).toBe(true);
    expect(
      result.messages.some((message) =>
        message.content.includes("memory reinjected after hard compaction"),
      ),
    ).toBe(true);
  });

  it("resolves sorted compaction thresholds and pressure", () => {
    const thresholds = resolveCompactionThresholds({
      budgetTokens: 10_000,
      warnRatio: 0.9,
      autoRatio: 0.7,
      hardRatio: 0.8,
    });

    expect(thresholds).toEqual({
      warnTokens: 7_000,
      autoTokens: 8_000,
      hardTokens: 9_000,
    });
    expect(resolveCompactionPressure({ usedTokens: 7_500, thresholds })).toBe(
      "warn",
    );
    expect(resolveCompactionPressure({ usedTokens: 8_500, thresholds })).toBe(
      "auto",
    );
    expect(resolveCompactionPressure({ usedTokens: 9_500, thresholds })).toBe(
      "hard",
    );
  });

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
    expect(result.pressure).toBe("hard");
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
