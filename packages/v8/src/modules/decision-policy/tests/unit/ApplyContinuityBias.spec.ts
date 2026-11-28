import { describe, expect, it } from "vitest";

import { applyContinuityBias } from "../../helpers/ApplyContinuityBias";

describe("applyContinuityBias", () => {
  it("promotes proposal_ready + act to execute", () => {
    const result = applyContinuityBias({
      mode: "agent",
      turnKind: "follow_up",
      endingPosture: "proposal_ready",
      priorRoute: "answer",
      interactionIntent: "act",
      primaryTaskIntent: "feature",
    });
    expect(result.preferredRoute).toBe("execute");
    expect(result.reasonCodes).toContain("continuity_bias_execute");
  });

  it("keeps proposal_ready + pure question on answer", () => {
    const result = applyContinuityBias({
      mode: "agent",
      turnKind: "follow_up",
      endingPosture: "proposal_ready",
      interactionIntent: "question",
      primaryTaskIntent: "question",
    });
    expect(result.preferredRoute).toBe("answer");
    expect(result.reasonCodes).toContain("continuity_bias_answer");
  });

  it("treats secondary mutation intents as act after incomplete execute", () => {
    const result = applyContinuityBias({
      mode: "agent",
      turnKind: "follow_up",
      endingPosture: "incomplete",
      interactionIntent: "question",
      primaryTaskIntent: "question",
      secondaryTaskIntents: ["feature"],
    });
    expect(result.preferredRoute).toBe("execute");
  });

  it("open checklist continues execute without re-plan", () => {
    const result = applyContinuityBias({
      mode: "agent",
      turnKind: "follow_up",
      endingPosture: "mutated",
      interactionIntent: "unknown",
      primaryTaskIntent: "feature",
      openExecutionChecklist: true,
    });
    expect(result.preferredRoute).toBe("execute");
    expect(result.reasonCodes).toContain("continuity_open_checklist");
  });

  it("never promotes ask mode", () => {
    const result = applyContinuityBias({
      mode: "ask",
      turnKind: "follow_up",
      endingPosture: "proposal_ready",
      interactionIntent: "act",
      primaryTaskIntent: "feature",
    });
    expect(result.preferredRoute).toBeUndefined();
  });

  it("no-ops without endingPosture", () => {
    const result = applyContinuityBias({
      mode: "agent",
      turnKind: "follow_up",
      interactionIntent: "act",
      primaryTaskIntent: "feature",
    });
    expect(result.preferredRoute).toBeUndefined();
  });

  it("defers answered + act to normal plate", () => {
    const result = applyContinuityBias({
      mode: "agent",
      turnKind: "follow_up",
      endingPosture: "answered",
      interactionIntent: "act",
      primaryTaskIntent: "feature",
    });
    expect(result.preferredRoute).toBeUndefined();
    expect(result.reasonCodes).toContain("continuity_answered_defer_plate");
  });
});
