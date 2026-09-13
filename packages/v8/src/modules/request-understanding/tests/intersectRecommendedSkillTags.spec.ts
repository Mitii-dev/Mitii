import { describe, expect, it } from "vitest";

import {
  DEFAULT_CLOSED_SKILL_TAGS,
  buildClosedSkillTagAllowlist,
  intersectRecommendedSkillTags,
} from "../intent/intersectRecommendedSkillTags";

describe("intersectRecommendedSkillTags", () => {
  it("keeps allowlisted tags and drops unknowns", () => {
    const result = intersectRecommendedSkillTags([
      "localize",
      "please-be-careful",
      "fix",
      "LOCALIZE",
    ]);
    expect(result.tags).toEqual(["localize", "fix"]);
    expect(result.dropped).toEqual(["please-be-careful"]);
  });

  it("respects maxTags", () => {
    const many = DEFAULT_CLOSED_SKILL_TAGS.slice(0, 12);
    const result = intersectRecommendedSkillTags(many, DEFAULT_CLOSED_SKILL_TAGS, 5);
    expect(result.tags).toHaveLength(5);
  });

  it("merges catalog tags into allowlist", () => {
    const allowlist = buildClosedSkillTagAllowlist(["custom-tag"]);
    const result = intersectRecommendedSkillTags(["custom-tag", "nope"], allowlist);
    expect(result.tags).toEqual(["custom-tag"]);
    expect(result.dropped).toEqual(["nope"]);
  });
});
