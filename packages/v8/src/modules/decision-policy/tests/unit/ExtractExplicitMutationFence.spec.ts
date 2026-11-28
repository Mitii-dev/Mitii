import { describe, expect, it } from "vitest";

import {
  extractExplicitMutationFence,
  hasExplicitEditLimit,
} from "../../helpers/ExtractExplicitMutationFence";

describe("ExtractExplicitMutationFence", () => {
  it("does not fence on bare path mentions", () => {
    expect(hasExplicitEditLimit("fix packages/mui-builder ts errors")).toBe(
      false,
    );
    expect(
      extractExplicitMutationFence("fix packages/mui-builder ts errors", [
        "packages/mui-builder",
      ]),
    ).toBeUndefined();
  });

  it("fences when only-edit prose is present", () => {
    expect(
      hasExplicitEditLimit("only edit packages/mui-builder please"),
    ).toBe(true);
    expect(
      extractExplicitMutationFence("only edit packages/mui-builder please", []),
    ).toEqual(["packages/mui-builder"]);
  });
});
