import { describe, expect, it } from "vitest";

import { selectDecisionPlate } from "../../plates";

describe("selectDecisionPlate", () => {
  it("clarifies on low confidence when ballot asks (anti-nag allows)", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "low",
      planningHint: "short",
      askUser: true,
      difficulty: "moderate",
      risk: "medium",
    });
    expect(plate.id).toBe("clarify_material");
    expect(plate.grantProfile).toBe("none");
  });

  it("uses research answer plate for questions", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
    });
    expect(plate.id).toBe("answer_research");
    expect(plate.grantProfile).toBe("research");
  });

  it("plan mode always picks plan plate", () => {
    const plate = selectDecisionPlate({
      mode: "plan",
      primaryTaskIntent: "feature",
      clarityConfidence: "high",
      planningHint: "long",
      askUser: false,
    });
    expect(plate.route).toBe("plan");
    expect(plate.planningDepth).toBe("visible");
  });
});
