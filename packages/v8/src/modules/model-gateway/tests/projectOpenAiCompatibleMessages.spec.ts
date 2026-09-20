import { describe, expect, it } from "vitest";

import { projectOpenAiCompatibleMessages } from "../adapters/OpenAiCompatibleLlmPort";

describe("projectOpenAiCompatibleMessages", () => {
  it("keeps a leading system prefix intact", () => {
    const projected = projectOpenAiCompatibleMessages([
      { role: "system", content: "You are Mitii." },
      { role: "user", content: "hello" },
    ]);
    expect(projected[0]?.role).toBe("system");
    expect(projected[1]?.role).toBe("user");
  });

  it("projects mid-conversation system updates to user (BillBuddy 21:00 failure)", () => {
    const projected = projectOpenAiCompatibleMessages([
      { role: "system", content: "You are Mitii." },
      { role: "user", content: "finish the cross suite" },
      { role: "assistant", content: "reading…" },
      { role: "tool", content: "{}", toolCallId: "call_1" },
      {
        role: "user",
        content:
          "The user approved continuing after a mutation recovery limit. Your next action MUST be apply_patch.",
      },
      {
        role: "system",
        content:
          "<context_epoch_update>\nAvailable skills are now: (none).\n</context_epoch_update>",
      },
      { role: "user", content: "<working_set trust=\"instruction\">…</working_set>" },
    ]);

    const roles = projected.map((message) => message.role);
    expect(roles.filter((role, index) => index > 0 && role === "system")).toEqual(
      [],
    );
    expect(projected[5]?.role).toBe("user");
    expect(projected[5]?.content).toContain("<context_epoch_update>");
  });
});
