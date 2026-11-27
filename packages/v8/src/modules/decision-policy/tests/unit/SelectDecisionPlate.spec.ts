import { describe, expect, it } from "vitest";

import { selectDecisionPlate } from "../../plates";

describe("selectDecisionPlate", () => {
  it("agent defers anti-nag clarify to plan seal when ballot asks", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "low",
      planningHint: "short",
      askUser: true,
      difficulty: "moderate",
      risk: "medium",
    });
    expect(plate.id).toBe("plan_visible_readonly");
    expect(plate.grantProfile).toBe("research");
    expect(plate.reasonCodes).toContain(
      "plate_agent_mode_defers_anti_nag_clarify",
    );
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

  it("keeps pure how-to questions on research even in agent mode", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      message: "How do I remove untracked tsconfig files?",
    });
    expect(plate.id).toBe("answer_research");
    expect(plate.grantProfile).toBe("research");
  });

  it("executes agent mutation asks misclassified as question", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "medium",
      planningHint: "none",
      askUser: false,
      message:
        "remove the latest changes which are not staged, which we did for tsconfigs",
    });
    expect(plate.route).toBe("execute");
    expect(plate.grantProfile).toBe("agent_execute");
    expect(plate.reasonCodes).toContain(
      "plate_agent_mutation_despite_question",
    );
  });

  it("executes follow-up Start implementing it despite question ballot", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      turnKind: "follow_up",
      message: "Start implementing it",
    });
    expect(plate.route).toBe("execute");
    expect(plate.grantProfile).toBe("agent_execute");
    expect(plate.reasonCodes).toContain(
      "plate_agent_mutation_despite_question",
    );
  });

  it("executes agent follow-up continue/yes without posture", () => {
    for (const message of ["continue", "yes", "go ahead", "do it"]) {
      const plate = selectDecisionPlate({
        mode: "agent",
        primaryTaskIntent: "question",
        clarityConfidence: "high",
        planningHint: "none",
        askUser: false,
        turnKind: "follow_up",
        message,
      });
      expect(plate.route).toBe("execute");
      expect(plate.grantProfile).toBe("agent_execute");
      expect(
        plate.reasonCodes.some(
          (code) =>
            code === "plate_continue_prompt_execute" ||
            code === "plate_agent_continue_as_execute",
        ),
      ).toBe(true);
    }
  });

  it("executes proposal_ready + act stance via continuity bias", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      turnKind: "follow_up",
      message: "you can continue but also add these checks",
      interactionIntent: "act",
      endingPosture: "proposal_ready",
      priorRoute: "answer",
    });
    expect(plate.route).toBe("execute");
    expect(plate.reasonCodes).toContain("continuity_bias_execute");
  });

  it("keeps proposal_ready + pure question on research", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      turnKind: "follow_up",
      message: "why did you pick notMatch first?",
      interactionIntent: "question",
      endingPosture: "proposal_ready",
      priorRoute: "answer",
    });
    expect(plate.route).toBe("answer");
    expect(plate.reasonCodes).toContain("continuity_bias_answer");
  });

  it("executes mixed act+question after proposal_ready", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      turnKind: "follow_up",
      message: "implement it, but should we also add jsonPath?",
      interactionIntent: "act",
      secondaryTaskIntents: ["question"],
      endingPosture: "proposal_ready",
      priorRoute: "answer",
    });
    expect(plate.route).toBe("execute");
    expect(plate.reasonCodes).toContain("continuity_bias_execute");
  });

  it("skips visible plan gate for localized create with explicit paths", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "high",
      planningHint: "long",
      askUser: false,
      message:
        "Complete redesign of priya-v1/index.html — create new-design.html",
    });
    expect(plate.route).toBe("execute");
    expect(plate.planningDepth).not.toBe("visible");
    expect(plate.reasonCodes).toContain("plate_localized_skip_visible_plan");
  });

  it("keeps ask-mode continue on research", () => {
    const plate = selectDecisionPlate({
      mode: "ask",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      turnKind: "follow_up",
      message: "continue",
      endingPosture: "proposal_ready",
      interactionIntent: "act",
    });
    expect(plate.id).toBe("answer_research");
    expect(plate.route).toBe("answer");
  });

  it("executes agent clear/git cleanup asks misclassified as question", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "medium",
      planningHint: "none",
      askUser: false,
      message:
        "there are some unwanted changes in my git\nclear them all are tsconfig changes",
    });
    expect(plate.route).toBe("execute");
    expect(plate.grantProfile).toBe("agent_execute");
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

  it("plan mode seals before anti-nag clarify on unclear ballot", () => {
    const plate = selectDecisionPlate({
      mode: "plan",
      primaryTaskIntent: "unclear",
      clarityConfidence: "low",
      planningHint: "long",
      askUser: true,
      difficulty: "complex",
      risk: "medium",
    });
    expect(plate.route).toBe("plan");
    expect(plate.id).toBe("plan_visible_readonly");
    expect(plate.grantProfile).toBe("research");
    expect(plate.reasonCodes).toContain(
      "plate_plan_mode_defers_anti_nag_clarify",
    );
  });

  it("agent mode seals plan before anti-nag clarify on unclear ballot", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "unclear",
      clarityConfidence: "low",
      planningHint: "long",
      askUser: true,
      difficulty: "complex",
      risk: "medium",
    });
    expect(plate.route).toBe("plan");
    expect(plate.id).toBe("plan_visible_readonly");
    expect(plate.reasonCodes).toContain(
      "plate_agent_mode_defers_anti_nag_clarify",
    );
  });

  it("agent visible campaigns seal plan-first instead of execute-visible", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "high",
      planningHint: "long",
      askUser: false,
      difficulty: "complex",
      risk: "medium",
      message:
        "Redesign HTTP checks and add React cases that prove the redesign",
    });
    expect(plate.route).toBe("plan");
    expect(plate.id).toBe("plan_visible_readonly");
    expect(plate.reasonCodes).toContain(
      "plate_agent_visible_seals_plan_first",
    );
  });

  it("open execution checklist continue executes next slice without re-plan", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "feature",
      clarityConfidence: "high",
      planningHint: "long",
      askUser: false,
      turnKind: "follow_up",
      message: "keep going on the remaining campaign work",
      openExecutionChecklist: true,
    });
    expect(plate.route).toBe("execute");
    expect(plate.id).toBe("execute_fast_path");
    expect(plate.reasonCodes).toContain("plate_open_checklist_continue");
  });

  it("chat leftover continue prompt fast-paths to execute", () => {
    const plate = selectDecisionPlate({
      mode: "agent",
      primaryTaskIntent: "question",
      clarityConfidence: "high",
      planningHint: "none",
      askUser: false,
      turnKind: "follow_up",
      message: "continue",
      openExecutionChecklist: true,
    });
    expect(plate.route).toBe("execute");
    expect(plate.reasonCodes).toContain("plate_continue_prompt_execute");
  });

  it("ask mode seals to answer even when planningHint is set", () => {
    const plate = selectDecisionPlate({
      mode: "ask",
      primaryTaskIntent: "feature",
      clarityConfidence: "high",
      planningHint: "short",
      askUser: false,
    });
    expect(plate.id).toBe("answer_research");
    expect(plate.route).toBe("answer");
    expect(plate.reasonCodes).toContain("plate_ask_mode_answer");
  });

  it("does not clarify follow_up unclear nudges", () => {
    const plate = selectDecisionPlate({
      mode: "ask",
      primaryTaskIntent: "unclear",
      clarityConfidence: "low",
      planningHint: "none",
      askUser: true,
      turnKind: "follow_up",
      message: "?",
    });
    expect(plate.route).not.toBe("clarify");
    expect(plate.id).toBe("answer_research");
  });
});
