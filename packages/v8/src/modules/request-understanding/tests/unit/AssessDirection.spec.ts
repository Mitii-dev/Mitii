import { describe, expect, it } from "vitest";

import {
  assessDirection,
  directionInputFromSituationPack,
} from "../../helpers/direction/AssessDirection";

describe("assessDirection", () => {
  it("emits unclear ballot for vague commands", () => {
    const ballot = assessDirection({
      schemaVersion: 1,
      userCommand: "fix it",
      mode: "agent",
    });
    expect(ballot.primaryTaskIntent).toBe("unclear");
    expect(ballot.askUserSuggested).toBe(true);
    expect(ballot.askUser).toBe(true);
  });

  it("maps SituationPack into direction input without rule priors", () => {
    const input = directionInputFromSituationPack({
      request: {
        text: "only edit packages/demo fix the bug",
        mode: "agent",
        intentCues: {
          readOnlyAsk: false,
          explicitEditLimit: true,
          pastedErrorOrStack: false,
          createAsk: false,
          debugAsk: true,
          constraintSnippets: ["only edit packages/demo"],
        },
      },
      scope: {
        focusPaths: ["packages/demo"],
        evidence: "explicit_limit",
        mutationFence: ["packages/demo"],
        readHint: "package",
      },
      pins: { skillIds: ["s1"], mcpIds: ["m1"] },
    });
    expect(input.attachedSkills).toEqual([{ id: "s1", required: true }]);
    expect(input.situationSummary.mutationFence).toEqual(["packages/demo"]);

    const ballot = assessDirection(input);
    expect(ballot.primaryTaskIntent).toBe("bugfix");
    expect(ballot.skillsAndMcp?.matchedSkillIds).toEqual(["s1"]);
    expect(ballot.reasonCodes).toContain("assess_direction_deterministic");
  });
});
