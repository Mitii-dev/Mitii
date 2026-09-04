import { describe, expect, it } from "vitest";

import {
  buildMissingPathGlobHints,
  selectMissingPathGlobHintsForMessage,
} from "../internal/missingPathGlobHints";

describe("missingPathGlobHints", () => {
  it("includes basename and CamelCase stem globs for missing files", () => {
    const hints = buildMissingPathGlobHints("Billing/BillPage.ts");
    expect(hints).toContain("**/BillPage.ts");
    expect(hints).toContain("**/Billing/BillPage.ts");
    expect(hints.some((hint) => hint.includes("*bill*") || hint.includes("*page*"))).toBe(
      true,
    );
  });

  it("builds stem wildcards for extensionless mentions", () => {
    const hints = buildMissingPathGlobHints("Desktop");
    expect(hints).toContain("**/Desktop");
    expect(hints).toContain("**/*Desktop*");
  });

  it("selects a compact primary hint for error messages", () => {
    expect(selectMissingPathGlobHintsForMessage("Billing/missing.spec.ts")).toEqual(
      expect.arrayContaining(["**/missing.spec.ts"]),
    );
    expect(
      selectMissingPathGlobHintsForMessage("Billing/missing.spec.ts").length,
    ).toBeLessThanOrEqual(2);
  });
});
