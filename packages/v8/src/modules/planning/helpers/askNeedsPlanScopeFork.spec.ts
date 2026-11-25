import { describe, expect, it } from "vitest";

import { askNeedsPlanScopeFork } from "./askNeedsPlanScopeFork";

describe("askNeedsPlanScopeFork", () => {
  it("skips clear single-outcome feature asks", () => {
    expect(
      askNeedsPlanScopeFork({
        clarity: "clear",
        primaryIntent: "feature",
        requestedOutcomes: ["Build Run Profiles for smoke/critical slices"],
        query:
          "Build Run Profiles so people can run the right slice. Add npm run test:profile.",
      }),
    ).toBe(false);
  });

  it("still forks short unclear asks without a concrete deliverable", () => {
    expect(
      askNeedsPlanScopeFork({
        clarity: "unclear",
        primaryIntent: "refactor",
        query: "Improve the test cases",
      }),
    ).toBe(true);
    expect(
      askNeedsPlanScopeFork({
        clarity: "ambiguous",
        primaryIntent: "feature",
        query: "Do the profiles thing somehow",
      }),
    ).toBe(true);
  });

  it("does not harness-fork a substantive feature ask marked unclear", () => {
    expect(
      askNeedsPlanScopeFork({
        clarity: "unclear",
        primaryIntent: "feature",
        requestedOutcomes: [
          "Run profiles configurable via command line",
          "README examples added",
        ],
        query:
          "Build Run Profiles so people can run the right slice without knowing folder paths. Ship smoke, critical, regression profiles and npm run test:profile.",
      }),
    ).toBe(false);
  });

  it("does not harness-fork concrete Build/Ship asks mis-tagged as docs", () => {
    expect(
      askNeedsPlanScopeFork({
        clarity: "unclear",
        primaryIntent: "docs",
        query:
          "Build Run Profiles so people can run the right slice. Ship smoke/critical profiles and npm run test:profile — update the README too.",
      }),
    ).toBe(false);
  });

  it("requires a fork for tests-or-architecture asks", () => {
    expect(
      askNeedsPlanScopeFork({
        clarity: "clear",
        primaryIntent: "refactor",
        query:
          "How I can improve the test cases? Can you plan or changing the architecture?",
      }),
    ).toBe(true);
  });

  it("skips clear bugfix with one outcome", () => {
    expect(
      askNeedsPlanScopeFork({
        clarity: "clear",
        primaryIntent: "bugfix",
        requestedOutcomes: ["Fix login flaky wait"],
        query: "Fix the flaky login wait in desktop smoke",
      }),
    ).toBe(false);
  });
});
