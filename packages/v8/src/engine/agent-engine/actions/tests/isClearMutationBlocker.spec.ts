import { describe, expect, it } from "vitest";

import { isClearMutationBlocker } from "../isClearMutationBlocker";

describe("isClearMutationBlocker", () => {
  it("accepts explicit blocker headers", () => {
    expect(
      isClearMutationBlocker(
        "Blocker: missing API credentials; no workspace edit can initialize Stripo.",
      ),
    ).toBe(true);
  });

  it("accepts cannot-edit plus external prerequisite language", () => {
    expect(
      isClearMutationBlocker(
        "I cannot patch this further. The runtime requires API key and config params that are not present in the repo.",
      ),
    ).toBe(true);
  });

  it("rejects short or transitional narration", () => {
    expect(isClearMutationBlocker("Blocked.")).toBe(false);
    expect(
      isClearMutationBlocker(
        "Let me check one more file before deciding whether we are blocked.",
      ),
    ).toBe(false);
    expect(
      isClearMutationBlocker(
        "Here are the remaining TypeScript errors I still need to fix in the workspace.",
      ),
    ).toBe(false);
  });
});
