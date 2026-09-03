import { describe, expect, it } from "vitest";

import { isWholeRequestReadOnlyConstraint } from "../intent/isWholeRequestReadOnlyConstraint";

describe("isWholeRequestReadOnlyConstraint", () => {
  it("treats scoped Do-not constraints on a Fix ask as not read-only", () => {
    const message = [
      "Fix Desktop headless Chrome support and clean up Billing page-object usage.",
      "",
      "## Constraints",
      "- Do not change test intent/coverage; only encapsulate selectors/actions.",
      "- Do not refactor Tablet/Appium unless required for shared config typing.",
    ].join("\n");

    expect(isWholeRequestReadOnlyConstraint(message)).toBe(false);
  });

  it("treats scoped Do-not-implement on an Implement ask as not read-only", () => {
    expect(
      isWholeRequestReadOnlyConstraint(
        "Implement auth. Do not implement logging yet.",
      ),
    ).toBe(false);
    expect(
      isWholeRequestReadOnlyConstraint(
        [
          "Fix Desktop headless Chrome support.",
          "",
          "## Constraints",
          "- Do not implement Tablet/Appium changes unless required.",
        ].join("\n"),
      ),
    ).toBe(false);
  });

  it("detects whole-request read-only asks", () => {
    expect(
      isWholeRequestReadOnlyConstraint(
        "Explain the auth architecture — do not change any files",
      ),
    ).toBe(true);
    expect(
      isWholeRequestReadOnlyConstraint(
        "Review this PR. No code changes.",
      ),
    ).toBe(true);
    expect(
      isWholeRequestReadOnlyConstraint("Diagnose only; do not implement"),
    ).toBe(true);
    expect(
      isWholeRequestReadOnlyConstraint(
        "Do not implement anything yet — just explain the design",
      ),
    ).toBe(true);
  });
});
