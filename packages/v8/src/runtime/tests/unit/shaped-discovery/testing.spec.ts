import { describe, expect, it } from "vitest";

import { resolveShapedDiscoveryProfile } from "../../../helpers/shaped-discovery/registry";
import { testingDiscoveryProfile } from "../../../helpers/shaped-discovery/profiles/testing";

describe("testingDiscoveryProfile", () => {
  it("matches improve-the-test-cases style Plan asks", () => {
    expect(
      testingDiscoveryProfile.matchesQuery(
        "How I can improve the test cases? Can you plan or changing the architecture?",
      ),
    ).toBe(true);
    expect(
      resolveShapedDiscoveryProfile(
        "How I can improve the test cases? Can you plan or changing the architecture?",
      )?.id,
    ).toBe("testing");
  });
});
