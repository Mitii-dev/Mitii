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
      budgetTokens: 1_000,
      minMessagesToKeep: 2,
      hardRatio: 0.3,
      maxMemoryReinjectChars: 200,
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
        message.content.includes("memory reinjected after compaction"),
      ),
    ).toBe(true);
  });

  it("reinjects mid-run established facts on auto compaction", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "old context ".repeat(100) },
      { role: "assistant", content: "old answer ".repeat(100) },
      { role: "user", content: "recent ask" },
      { role: "assistant", content: "recent answer" },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 1_000,
      minMessagesToKeep: 2,
      warnRatio: 0.2,
      autoRatio: 0.35,
      hardRatio: 0.95,
      maxEstablishedFactReinjectChars: 400,
      establishedFacts: [
        {
          id: "read_file:src/formik.ts",
          content: "src/formik.ts: useFormik returns [values, helpers] not [helpers, values]",
        },
      ],
    });

    expect(result.pressure).toBe("auto");
    expect(result.reinjectedEstablishedFacts).toBe(true);
    expect(
      result.messages.some((message) =>
        message.content.includes("established observations after compaction"),
      ),
    ).toBe(true);
    expect(
      result.messages.some((message) =>
        message.content.includes("useFormik returns [values, helpers]"),
      ),
    ).toBe(true);
  });

  it("summarizes dropped tool turns with path and finding", () => {
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "read it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_old",
            name: "read_file",
            arguments: JSON.stringify({ path: "src/form.ts", startLine: 3 }),
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_old",
        content: JSON.stringify({
          status: "succeeded",
          toolName: "read_file",
          callId: "call_old",
          output: {
            path: "src/form.ts",
            content: "export function buildForm() { return values; }",
          },
        }),
      },
      { role: "user", content: "newer context ".repeat(100) },
      { role: "assistant", content: "recent answer" },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 500,
      minMessagesToKeep: 2,
      droppedTurnSummaryChars: 1_000,
    });

    const summary = result.messages.find((message) =>
      message.content.includes("compacted prior context"),
    )?.content;

    expect(summary).toContain("read_file src/form.ts:3");
    expect(summary).toContain("buildForm");
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
    expect(JSON.parse(oldToolCall?.arguments ?? "{}")).toEqual({
      patches: [
        {
          path: "src/large.ts",
          oldText: "[compacted prior patch]",
          newText: "[compacted prior patch]",
        },
      ],
    });
    expect(oldToolCall?.arguments).not.toContain(
      "previous_completed_tool_call_arguments_omitted",
    );
    expect(oldToolCall?.arguments).not.toContain("originalArgumentCharacters");
    expect(recentToolCall?.arguments).toBe(
      JSON.stringify({ path: "src/large.ts" }),
    );
    expect(
      result.messages.find((message) => message.toolCallId === "call_old")
        ?.content.length,
    ).toBeLessThan(1_000);
  });

  it("keeps compacted read tool arguments schema-shaped", () => {
    const hugeArguments = JSON.stringify({
      path: "src/large.ts",
      startLine: 10,
      endLine: 40,
      extraContext: "x".repeat(10_000),
    });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "fix it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_old_read",
            name: "read_file",
            arguments: hugeArguments,
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_old_read",
        content: JSON.stringify({
          status: "succeeded",
          output: "x".repeat(6_000),
        }),
      },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 1_200,
      recentToolMessagesToKeepFull: 0,
      minMessagesToKeep: 4,
    });

    const oldToolCall = result.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === "call_old_read");

    expect(result.compacted).toBe(true);
    expect(oldToolCall?.arguments).toBe(
      JSON.stringify({
        path: "src/large.ts",
        startLine: 10,
        endLine: 40,
      }),
    );
    expect(oldToolCall?.arguments).not.toContain(
      "previous_completed_tool_call_arguments_omitted",
    );
  });

  it("keeps compacted apply_patch arguments schema-shaped", () => {
    const hugeArguments = JSON.stringify({
      patches: [
        {
          path: "src/form.ts",
          oldText: "a".repeat(8_000),
          newText: "b".repeat(8_000),
        },
      ],
    });
    const messages: ModelMessage[] = [
      { role: "system", content: "system" },
      { role: "user", content: "fix it" },
      {
        role: "assistant",
        content: "",
        toolCalls: [
          {
            id: "call_old_patch",
            name: "apply_patch",
            arguments: hugeArguments,
          },
        ],
      },
      {
        role: "tool",
        toolCallId: "call_old_patch",
        content: JSON.stringify({
          status: "succeeded",
          output: "patched",
        }),
      },
    ];

    const result = compactModelLoopMessages({
      messages,
      estimator,
      budgetTokens: 1_200,
      recentToolMessagesToKeepFull: 0,
      minMessagesToKeep: 4,
    });

    const oldToolCall = result.messages
      .flatMap((message) => message.toolCalls ?? [])
      .find((toolCall) => toolCall.id === "call_old_patch");

    expect(result.compacted).toBe(true);
    expect(JSON.parse(oldToolCall?.arguments ?? "{}")).toEqual({
      patches: [
        {
          path: "src/form.ts",
          oldText: "[compacted prior patch]",
          newText: "[compacted prior patch]",
        },
      ],
    });
    expect(oldToolCall?.arguments).not.toContain("originalArgumentCharacters");
  });

  it("caps auto compaction with an absolute token ceiling", () => {
    const thresholds = resolveCompactionThresholds({
      budgetTokens: 200_000,
      autoMaxTokens: 32_000,
      hardMaxTokens: 40_000,
    });
    expect(thresholds.autoTokens).toBe(32_000);
    expect(thresholds.hardTokens).toBe(40_000);
    expect(thresholds.warnTokens).toBeLessThanOrEqual(thresholds.autoTokens);
  });

  it("delays auto compaction until the hard ceiling when preserving the prefix", () => {
    const thresholds = resolveCompactionThresholds({
      budgetTokens: 200_000,
      autoMaxTokens: 32_000,
      hardMaxTokens: 40_000,
      preservePrefix: true,
    });
    expect(thresholds.autoTokens).toBe(thresholds.hardTokens);
    expect(thresholds.autoTokens).toBe(40_000);
  });
});
