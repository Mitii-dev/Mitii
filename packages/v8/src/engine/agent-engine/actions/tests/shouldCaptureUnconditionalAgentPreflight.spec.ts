import { describe, expect, it } from "vitest";

import { shouldCaptureUnconditionalAgentPreflight } from "../shouldCaptureUnconditionalAgentPreflight";

describe("shouldCaptureUnconditionalAgentPreflight", () => {
  it("skips yes/no status questions", () => {
    expect(
      shouldCaptureUnconditionalAgentPreflight("is headless implemented ??"),
    ).toBe(false);
  });

  it("skips run-the-tests asks so WDIO is not launched before the model", () => {
    expect(
      shouldCaptureUnconditionalAgentPreflight(
        "Can you run the tests and see what all are failing and passing ??",
      ),
    ).toBe(false);
  });

  it("captures for explicit repair asks", () => {
    expect(
      shouldCaptureUnconditionalAgentPreflight(
        "@packages/mui-builder fix all the ts errors",
      ),
    ).toBe(true);
  });

  it("captures for implement asks even when phrased as can-you", () => {
    expect(
      shouldCaptureUnconditionalAgentPreflight(
        "Can you implement multi emulator testing in the tablet tab",
      ),
    ).toBe(true);
  });
});
