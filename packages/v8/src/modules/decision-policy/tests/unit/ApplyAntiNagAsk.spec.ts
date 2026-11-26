import { describe, expect, it } from "vitest";

import { applyAntiNagAsk } from "../../helpers/ApplyAntiNagAsk";
import { selectDecisionPlate } from "../../plates/SelectDecisionPlate";

describe("applyAntiNagAsk", () => {
  it("always allows ask for unclear primary", () => {
    const result = applyAntiNagAsk({
      askUserSuggested: true,
      primaryTaskIntent: "unclear",
      difficulty: "simple",
      risk: "low",
      clarityConfidence: "low",
    });
    expect(result.askUser).toBe(true);
  });

  it("suppresses ask for simple low-risk clear tasks", () => {
    const result = applyAntiNagAsk({
      askUserSuggested: true,
      primaryTaskIntent: "feature",
      difficulty: "simple",
      risk: "low",
      clarityConfidence: "medium",
    });
    expect(result.askUser).toBe(false);
    expect(result.reasonCodes).toContain("clamp_anti_nag_clarify");
  });

  it("answers userQuestions instead of clarifying", () => {
    const result = applyAntiNagAsk({
      askUserSuggested: true,
      primaryTaskIntent: "feature",
      difficulty: "moderate",
      risk: "medium",
      clarityConfidence: "medium",
      userQuestions: ["Which framework?"],
    });
    expect(result.askUser).toBe(false);
    expect(result.reasonCodes).toContain("anti_nag_answer_user_questions");
  });
});

describe("selectDecisionPlate + anti-nag", () => {
  it("does not clarify when anti-nag suppresses ballot ask", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "medium",
      planningHint: "short",
      askUser: true,
      difficulty: "simple",
      risk: "low",
    });
    expect(plate.route).not.toBe("clarify");
    expect(plate.reasonCodes).toContain("clamp_anti_nag_clarify");
  });

  it("still clarifies vague unclear asks", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "unclear",
      clarityConfidence: "low",
      planningHint: "none",
      askUser: true,
      difficulty: "simple",
      risk: "low",
    });
    expect(plate.route).toBe("clarify");
  });
});
