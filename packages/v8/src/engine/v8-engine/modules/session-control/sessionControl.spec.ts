import { describe, expect, it } from "vitest";

import { CharacterTokenEstimator } from "../../../../modules/prompt-construction";
import type { ModelMessage } from "../../../../modules/model-gateway";

import { handleMetaCommand } from "./handleMetaCommand";
import { forceCompactConversation } from "./forceCompactConversation";
import { SESSION_CONTROL_HELP_TEXT } from "./constants";

const estimator = new CharacterTokenEstimator();

function manyTurns(count: number): ModelMessage[] {
  const messages: ModelMessage[] = [
    { role: "system", content: "You are Mitii." },
  ];
  for (let i = 0; i < count; i += 1) {
    messages.push({
      role: "user",
      content: `User turn ${i} with enough text to matter for token estimates. `.repeat(20),
    });
    messages.push({
      role: "assistant",
      content: `Assistant reply ${i} with tool-ish detail. `.repeat(20),
      toolCalls: [
        {
          id: `call_${i}`,
          name: "read_file",
          arguments: JSON.stringify({
            path: `src/file_${i}.ts`,
            note: "x".repeat(800),
          }),
        },
      ],
    });
    messages.push({
      role: "tool",
      toolCallId: `call_${i}`,
      content: `file contents ${i} `.repeat(200),
    });
  }
  return messages;
}

describe("session-control handleMetaCommand", () => {
  it("stops with cancelled status", () => {
    const result = handleMetaCommand({
      meta: { name: "stop", args: "", lifecycle: "stop" },
      estimator,
    });
    expect(result.status).toBe("cancelled");
    expect(result.reasonCodes).toContain("session_control_stop");
    expect(result.error?.code).toBe("cancelled");
  });

  it("finalizes /new and /clear for the host", () => {
    const neu = handleMetaCommand({
      meta: { name: "new", args: "", lifecycle: "finalize" },
      estimator,
    });
    expect(neu.sessionAction).toBe("new");
    expect(neu.reasonCodes).toContain("session_control_finalized");

    const clear = handleMetaCommand({
      meta: { name: "clear", args: "", lifecycle: "finalize" },
      estimator,
    });
    expect(clear.sessionAction).toBe("clear");
  });

  it("returns help text", () => {
    const result = handleMetaCommand({
      meta: { name: "help", args: "", lifecycle: "side_channel" },
      estimator,
    });
    expect(result.answer).toBe(SESSION_CONTROL_HELP_TEXT);
    expect(result.reasonCodes).toContain("session_control_side_channel");
  });

  it("compacts a long conversation and returns replacement transcript", () => {
    const conversation = manyTurns(12);
    const result = handleMetaCommand({
      meta: { name: "compact", args: "", lifecycle: "side_channel" },
      conversation,
      estimator,
    });
    expect(result.reasonCodes).toContain("session_control_compacted");
    expect(result.compactedConversation).toBeDefined();
    expect(result.compactStats?.beforeMessages).toBe(conversation.length);
    expect(result.compactStats!.afterMessages).toBeLessThan(
      result.compactStats!.beforeMessages,
    );
    expect(result.answer).toMatch(/Compacted conversation/i);
  });

  it("reports empty conversation for compact", () => {
    const result = handleMetaCommand({
      meta: { name: "compact", args: "", lifecycle: "side_channel" },
      conversation: [],
      estimator,
    });
    expect(result.answer).toMatch(/Nothing to compact/i);
    expect(result.compactedConversation).toEqual([]);
  });
});

describe("forceCompactConversation", () => {
  it("reduces oversized histories", () => {
    const messages = manyTurns(10);
    const forced = forceCompactConversation({ messages, estimator });
    expect(forced.compacted).toBe(true);
    expect(forced.messages.length).toBeLessThan(messages.length);
  });
});
