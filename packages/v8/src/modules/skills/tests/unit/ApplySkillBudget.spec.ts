import { describe, expect, it } from "vitest";

import { applySkillBudget } from "../../actions/ApplySkillBudget";
import type { HydratedScoredSkill } from "../../actions/ApplySkillBudget";

function scored(
  partial: Omit<HydratedScoredSkill, "reasons" | "score"> & {
    score?: number;
    reasons?: string[];
  },
): HydratedScoredSkill {
  return {
    score: partial.score ?? 1,
    reasons: partial.reasons ?? ["primary_intent"],
    skill: partial.skill,
    compactContent: partial.compactContent,
  };
}

describe("applySkillBudget", () => {
  it("keeps a ranked skill via compact content instead of letting a smaller later skill replace it", () => {
    const result = applySkillBudget({
      budgetTokens: 80,
      maxSkills: 2,
      scored: [
        scored({
          skill: {
            id: "debugging-and-error-recovery",
            title: "Debugging",
            content: "F".repeat(800),
            intents: ["bugfix"],
            routes: ["execute"],
            tags: ["debug"],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 175,
            alwaysApply: false,
          },
          compactContent:
            "Skill: Debugging\nInstruction: Reproduce, localize, fix the root cause.",
        }),
        scored({
          skill: {
            id: "bugfix-localize",
            title: "Localize",
            content: "Prefer the smallest change that fixes the reported failure.",
            intents: ["bugfix"],
            routes: ["execute"],
            tags: ["fix"],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 120,
            alwaysApply: false,
          },
        }),
      ],
    });

    expect(result.instructions.map((block) => block.id)).toEqual([
      "debugging-and-error-recovery",
      "bugfix-localize",
    ]);
    expect(result.instructions[0]?.content).toContain("Reproduce, localize");
    expect(result.instructions[0]?.content).not.toContain("F".repeat(40));
    expect(result.compacted).toBe(true);
    expect(result.budgetOmitted).toBe(false);
    expect(result.usedTokens).toBeLessThanOrEqual(80);
  });

  it("omits a huge skill that has no distinct compact body", () => {
    const result = applySkillBudget({
      budgetTokens: 60,
      maxSkills: 5,
      scored: [
        scored({
          skill: {
            id: "huge-skill",
            title: "Huge",
            content: "X".repeat(4_000),
            intents: ["bugfix"],
            routes: ["execute"],
            tags: [],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 90,
            alwaysApply: false,
          },
        }),
        scored({
          skill: {
            id: "bugfix-localize",
            title: "Localize",
            content: "Prefer the smallest change.",
            intents: ["bugfix"],
            routes: ["execute"],
            tags: [],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 80,
            alwaysApply: false,
          },
        }),
      ],
    });

    expect(result.instructions.map((block) => block.id)).toEqual([
      "bugfix-localize",
    ]);
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ skillId: "huge-skill", reason: "budget" }),
      ]),
    );
    expect(result.budgetOmitted).toBe(true);
  });

  it("prefers compact L1 for a large skill so a later medium skill still fits", () => {
    const result = applySkillBudget({
      budgetTokens: 120,
      maxSkills: 2,
      scored: [
        scored({
          skill: {
            id: "planning-and-task-breakdown",
            title: "Planning",
            content: "L".repeat(3_000),
            sizeClass: "L",
            intents: ["feature"],
            routes: ["execute"],
            tags: [],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 200,
            alwaysApply: false,
          },
          compactContent: "Skill: Planning\nKeep plans short and executable.",
        }),
        scored({
          skill: {
            id: "incremental-implementation",
            title: "Incremental",
            content: "Ship the smallest correct batch, then verify.",
            sizeClass: "M",
            intents: ["feature"],
            routes: ["execute"],
            tags: [],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 180,
            alwaysApply: false,
          },
        }),
      ],
    });

    expect(result.instructions.map((block) => block.id)).toEqual([
      "planning-and-task-breakdown",
      "incremental-implementation",
    ]);
    expect(result.instructions[0]?.content).toContain("Keep plans short");
    expect(result.compacted).toBe(true);
  });

  it("omits L skills when forbidLargeSkills is set", () => {
    const result = applySkillBudget({
      budgetTokens: 500,
      maxSkills: 3,
      forbidLargeSkills: true,
      scored: [
        scored({
          skill: {
            id: "planning-and-task-breakdown",
            title: "Planning",
            content: "L".repeat(3_000),
            sizeClass: "L",
            intents: ["feature"],
            routes: ["execute"],
            tags: [],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 200,
            alwaysApply: false,
          },
        }),
        scored({
          skill: {
            id: "incremental-implementation",
            title: "Incremental",
            content: "Ship the smallest correct batch.",
            sizeClass: "M",
            intents: ["feature"],
            routes: ["execute"],
            tags: [],
            paths: [],
            languages: [],
            projectKinds: [],
            priority: 180,
            alwaysApply: false,
          },
        }),
      ],
    });

    expect(result.instructions.map((block) => block.id)).toEqual([
      "incremental-implementation",
    ]);
    expect(result.omissions).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          skillId: "planning-and-task-breakdown",
          reason: "budget",
        }),
      ]),
    );
  });
});
