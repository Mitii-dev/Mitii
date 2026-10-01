import { describe, expect, it } from "vitest";

import { looksLikeVcsHistoryRewrite } from "./DetectVcsHistoryRewrite";

describe("looksLikeVcsHistoryRewrite", () => {
  it("detects DCO incorrectly signed off prompts", () => {
    expect(
      looksLikeVcsHistoryRewrite(
        "Error: All commits (9ee7a42..170ce6b) are incorrectly signed off.\n\nin .github/workflows/dco.yml\n\nFix it",
      ),
    ).toBe(true);
  });

  it("detects Signed-off-by / amend asks", () => {
    expect(
      looksLikeVcsHistoryRewrite(
        "Amend commits to add Signed-off-by trailers on this branch",
      ),
    ).toBe(true);
  });

  it("ignores unrelated workflow edits", () => {
    expect(
      looksLikeVcsHistoryRewrite(
        "Update the CI workflow to use node 22 and cache pnpm",
      ),
    ).toBe(false);
  });
});
