import { describe, expect, it } from "vitest";

import { resolveRunAutoOptions } from "./runAuto.js";

describe("resolveRunAutoOptions", () => {
  it("requires --auto", () => {
    const result = resolveRunAutoOptions({ auto: false });
    expect(result).toEqual(
      expect.objectContaining({
        error: expect.stringContaining("--auto"),
      }),
    );
  });

  it("defaults to apply autonomy for CI", () => {
    expect(resolveRunAutoOptions({ auto: true })).toEqual({
      autonomyPreset: "apply",
      autoApproval: "approved",
      origin: "automation",
    });
  });

  it("preserves an explicit autonomy preset", () => {
    expect(
      resolveRunAutoOptions({ auto: true, autonomyPreset: "apply_and_pr" }),
    ).toEqual({
      autonomyPreset: "apply_and_pr",
      autoApproval: "approved",
      origin: "automation",
    });
  });
});
