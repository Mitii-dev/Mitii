import { describe, expect, it } from "vitest";

import { intersectRecommendedSkillTags } from "../intent/intersectRecommendedSkillTags";
import { BALLOT_EVAL_CASES } from "./fixtures/ballotEvalCases";

describe("ballot eval fixtures (Phase 0)", () => {
  it("exports non-empty golden cases with ids", () => {
    expect(BALLOT_EVAL_CASES.length).toBeGreaterThanOrEqual(5);
    const ids = new Set(BALLOT_EVAL_CASES.map((c) => c.id));
    expect(ids.size).toBe(BALLOT_EVAL_CASES.length);
  });

  it("documents open-vocab tag drop expectation via intersect helper", () => {
    const tagCase = BALLOT_EVAL_CASES.find((c) => c.id === "open-vocab-tag-drop");
    expect(tagCase).toBeDefined();
    const skillExp = tagCase!.expectations.find((e) => e.kind === "skill_tags");
    expect(skillExp?.kind).toBe("skill_tags");
    if (skillExp?.kind !== "skill_tags") return;
    const result = intersectRecommendedSkillTags([
      ...(skillExp.expectedTagsSubset ?? []),
      ...(skillExp.droppedTags ?? []),
    ]);
    for (const tag of skillExp.expectedTagsSubset ?? []) {
      expect(result.tags.map((t) => t.toLowerCase())).toContain(tag.toLowerCase());
    }
    for (const tag of skillExp.droppedTags ?? []) {
      expect(result.dropped.map((t) => t.toLowerCase())).toContain(tag.toLowerCase());
    }
  });
});
