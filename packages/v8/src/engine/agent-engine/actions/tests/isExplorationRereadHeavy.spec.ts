import { describe, expect, it } from "vitest";

import { isExplorationRereadHeavy } from "../isExplorationRereadHeavy";

describe("isExplorationRereadHeavy", () => {
  it("is false below the minimum call count", () => {
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 7,
        uniqueFilePathsTouched: 1,
      }),
    ).toBe(false);
  });

  it("is true when reads are at least 2x unique paths", () => {
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 8,
        uniqueFilePathsTouched: 1,
      }),
    ).toBe(true);
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 8,
        uniqueFilePathsTouched: 4,
      }),
    ).toBe(true);
  });

  it("is false when reads stay below the ratio", () => {
    expect(
      isExplorationRereadHeavy({
        fileReadCalls: 8,
        uniqueFilePathsTouched: 5,
      }),
    ).toBe(false);
  });
});
