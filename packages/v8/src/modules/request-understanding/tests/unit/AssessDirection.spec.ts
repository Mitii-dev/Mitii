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

  it("treats remove/clear working-tree asks as mutation acts", () => {
    const removeBallot = assessDirection({
      schemaVersion: 1,
      userCommand:
        "remove the latest changes which are not staged, which we did for tsconfigs",
      mode: "agent",
    });
    expect(removeBallot.primaryTaskIntent).toBe("refactor");
    expect(removeBallot.interactionIntent).toBe("act");

    const clearBallot = assessDirection({
      schemaVersion: 1,
      userCommand:
        "there are some unwanted changes in my git\nclear them all are tsconfig changes",
      mode: "agent",
    });
    expect(clearBallot.primaryTaskIntent).toBe("refactor");
    expect(clearBallot.interactionIntent).toBe("act");
  });

  it("keeps explain-how-to as question despite add verb", () => {
    const ballot = assessDirection({
      schemaVersion: 1,
      userCommand: "explain how to add new test case in this project",
      mode: "ask",
    });
    expect(ballot.primaryTaskIntent).toBe("question");
    expect(ballot.interactionIntent).toBe("question");
    expect(ballot.planningHint).toBe("none");
  });

  it("treats follow_up ? as continuation nudge not unclear clarify", () => {
    const ballot = assessDirection({
      schemaVersion: 1,
      userCommand: "?",
      mode: "ask",
      turnKind: "follow_up",
    });
    expect(ballot.primaryTaskIntent).toBe("question");
    expect(ballot.askUserSuggested).toBe(false);
    expect(ballot.reasonCodes).toContain("assess_continuation_nudge");
  });
});
