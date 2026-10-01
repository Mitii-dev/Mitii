import { describe, expect, it } from "vitest";

import { buildUnderstandingHistoryDigest } from "../actions/isIncompleteAssistantTurn";

describe("buildUnderstandingHistoryDigest", () => {
  it("returns undefined for empty conversation", () => {
    expect(buildUnderstandingHistoryDigest([])).toBeUndefined();
  });

  it("summarizes recent user/assistant turns", () => {
    const digest = buildUnderstandingHistoryDigest([
      { role: "user", content: "fix login" },
      { role: "assistant", content: "I will patch LoginForm.tsx" },
      { role: "user", content: "go ahead" },
    ]);
    expect(digest).toBeDefined();
    expect(digest).toContain("prior_turns=3");
    expect(digest).toContain("user: go ahead");
    expect(digest).toContain("assistant: I will patch LoginForm.tsx");
  });

  it("clips long contents and includes optional prior route", () => {
    const digest = buildUnderstandingHistoryDigest(
      [{ role: "user", content: "x".repeat(400) }],
      { priorRoute: "execute" },
    );
    expect(digest).toContain("prior_route=execute");
    expect(digest!.length).toBeLessThanOrEqual(4000);
    expect(digest).toContain("…");
  });
});
