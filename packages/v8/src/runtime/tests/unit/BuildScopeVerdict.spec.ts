import { describe, expect, it } from "vitest";

import {
  buildScopeVerdict,
  extractFocusPaths,
  extractIntentCues,
} from "../../helpers/orient";

describe("BuildScopeVerdict", () => {
  it("treats folder mentions as focus_only without mutationFence", () => {
    const message = "refactor packages/v8/src/runtime please";
    const focusPaths = extractFocusPaths(message);
    const scope = buildScopeVerdict({ message, focusPaths });

    expect(focusPaths).toContain("packages/v8/src/runtime");
    expect(scope.evidence).toBe("focus_only");
    expect(scope.mutationFence).toBeUndefined();
    expect(scope.readHint).not.toBeUndefined();
  });

  it("sets mutationFence when prose says only under a folder", () => {
    const message =
      "fix tests only under @suites/js/atomic/backend/apollo-user-query";
    const focusPaths = extractFocusPaths(message);
    const scope = buildScopeVerdict({ message, focusPaths });

    expect(scope.evidence).toBe("explicit_limit");
    expect(scope.mutationFence).toEqual([
      "suites/js/atomic/backend/apollo-user-query",
    ]);
  });

  it("extracts intent cues for pasted errors and edit limits", () => {
    const cues = extractIntentCues(
      "TypeError: x is not a function\nonly edit packages/demo",
    );
    expect(cues.pastedErrorOrStack).toBe(true);
    expect(cues.explicitEditLimit).toBe(true);
    expect(cues.debugAsk).toBe(false);
  });
});
