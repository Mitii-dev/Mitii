import { describe, expect, it } from "vitest";

import { matchGlob } from "../internal/GlobMatch";

describe("matchGlob", () => {
  it("matches ** globs case-insensitively", () => {
    expect(matchGlob("Billing/billing.spec.ts", "**/billing/**")).toBe(true);
    expect(matchGlob("Billing/billing.spec.ts", "**/Billing/*.spec.ts")).toBe(
      true,
    );
    expect(matchGlob("src/Desktop.ts", "**/desktop.ts")).toBe(true);
  });

  it("still respects path segment wildcards", () => {
    expect(matchGlob("a/b/c.ts", "a/*/c.ts")).toBe(true);
    expect(matchGlob("a/b/d/c.ts", "a/*/c.ts")).toBe(false);
  });
});
