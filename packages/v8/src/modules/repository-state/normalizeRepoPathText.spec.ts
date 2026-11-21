import { describe, expect, it } from "vitest";

import { normalizeRepoPathText } from "./normalizeRepoPathText";

describe("normalizeRepoPathText", () => {
  it("normalizes slashes, dot-prefix, duplicate and trailing slashes", () => {
    expect(normalizeRepoPathText("  .\\src\\\\app//index.ts/ ")).toBe(
      "src/app/index.ts",
    );
  });

  it("keeps @ mentions unless stripAtPrefix is set", () => {
    expect(normalizeRepoPathText("@src/a.ts")).toBe("@src/a.ts");
    expect(normalizeRepoPathText("@@src/a.ts", { stripAtPrefix: true })).toBe(
      "src/a.ts",
    );
  });

  it("returns the empty fallback only for empty results", () => {
    expect(normalizeRepoPathText("./")).toBe("");
    expect(normalizeRepoPathText("  ", { emptyFallback: "." })).toBe(".");
    expect(normalizeRepoPathText("a", { emptyFallback: "." })).toBe("a");
  });
});
