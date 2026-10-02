import { describe, expect, it } from "vitest";

import {
  MEDIUM_PLANNING_SKILL_ID,
  resolvePreferredSkillIdsForRun,
} from "./resolvePreferredSkillIds";

describe("resolvePreferredSkillIdsForRun", () => {
  it("soft-prefers medium-planning for medium plan/execute", () => {
    expect(
      resolvePreferredSkillIdsForRun({
        taskSize: "medium",
        route: "execute",
      }),
    ).toEqual([MEDIUM_PLANNING_SKILL_ID]);
    expect(
      resolvePreferredSkillIdsForRun({
        taskSize: "medium",
        route: "plan",
      }),
    ).toEqual([MEDIUM_PLANNING_SKILL_ID]);
  });

  it("does not prefer medium-planning for small or diagnose", () => {
    expect(
      resolvePreferredSkillIdsForRun({
        taskSize: "small",
        route: "execute",
      }),
    ).toEqual([]);
    expect(
      resolvePreferredSkillIdsForRun({
        taskSize: "medium",
        route: "diagnose",
      }),
    ).toEqual([]);
    expect(
      resolvePreferredSkillIdsForRun({
        taskSize: "large",
        route: "execute",
      }),
    ).toEqual([]);
  });
});
