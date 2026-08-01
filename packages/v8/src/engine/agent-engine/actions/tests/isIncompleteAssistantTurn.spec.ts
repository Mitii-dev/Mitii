import { describe, expect, it } from "vitest";

import {
  amendMessageWithPriorConversation,
  buildIncompleteAnswerRecoveryMessage,
  isEmptyAssistantTurn,
  isTransitionalAssistantAnswer,
  shouldRecoverIncompleteAssistantTurn,
  synthesizeFallbackAnswer,
} from "../isIncompleteAssistantTurn";

describe("isIncompleteAssistantTurn", () => {
  it("detects empty turns", () => {
    expect(
      isEmptyAssistantTurn({ content: "", toolCallCount: 0 }),
    ).toBe(true);
    expect(
      isEmptyAssistantTurn({ content: "hi", toolCallCount: 0 }),
    ).toBe(false);
    expect(
      isEmptyAssistantTurn({ content: "", toolCallCount: 1 }),
    ).toBe(false);
  });

  it("detects transitional narration from the billbuddy log", () => {
    expect(
      isTransitionalAssistantAnswer(
        "Let me check kitchen-flow.spec.ts more carefully:",
      ),
    ).toBe(true);
    expect(
      isTransitionalAssistantAnswer(
        "Now let me read more files to understand the full picture:",
      ),
    ).toBe(true);
    expect(
      isTransitionalAssistantAnswer(
        "Yes — the old Desktop/Tablet page objects were removed and imports were updated.",
      ),
    ).toBe(false);
  });

  it("recovers empty and transitional finals", () => {
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: "",
        toolCallCount: 0,
        changedFileCount: 3,
      }),
    ).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: "Let me explore the project:",
        toolCallCount: 0,
        changedFileCount: 0,
      }),
    ).toBe(true);
    expect(
      shouldRecoverIncompleteAssistantTurn({
        content: "Let me explore the project:",
        toolCallCount: 2,
        changedFileCount: 0,
      }),
    ).toBe(false);
  });

  it("builds recovery and fallback answers", () => {
    const recovery = buildIncompleteAnswerRecoveryMessage({
      changedFiles: ["a.ts", "b.ts"],
      emptyTurn: true,
    });
    expect(recovery).toContain("no content");
    expect(recovery).toContain("a.ts");

    expect(
      synthesizeFallbackAnswer({
        priorAnswer: "Let me check carefully:",
        changedFiles: ["test/a.ts"],
      }),
    ).toContain("Completed workspace edits");
  });

  it("amends understanding message with prior conversation", () => {
    const amended = amendMessageWithPriorConversation(
      "<<<MITII_USER_MESSAGE>>>\ndid you clear the old files ??\n\n<<<MITII_HOST_CONTEXT>>>\nWorkspace file map (2 files):\n- a.ts",
      [
        {
          role: "user",
          content: "restructure this project",
        },
        {
          role: "assistant",
          content: "Completed workspace edits.\nChanged files (2): a.ts, b.ts",
        },
      ],
      (text) => {
        const marker = "<<<MITII_USER_MESSAGE>>>";
        const idx = text.indexOf(marker);
        if (idx < 0) return text;
        const after = text.slice(idx + marker.length).trimStart();
        const hostIdx = after.indexOf("<<<MITII_HOST_CONTEXT>>>");
        return (hostIdx >= 0 ? after.slice(0, hostIdx) : after).trim();
      },
    );
    expect(amended).toContain("Prior conversation");
    expect(amended).toContain("restructure this project");
    expect(amended).toContain("Current user request:");
    expect(amended).toContain("did you clear the old files ??");
    expect(amended).not.toContain("Workspace file map");
  });
});
