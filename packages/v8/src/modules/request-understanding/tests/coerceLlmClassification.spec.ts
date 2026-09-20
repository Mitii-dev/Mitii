import { describe, expect, it } from "vitest";
import { intentClassificationSchema } from "../intent/schema";
import {
  coerceLlmClassificationJson,
  salvageLlmClassificationStages,
  stripTaskHints,
} from "../intent/classifiers/llm/coerceLlmClassification";

describe("coerceLlmClassificationJson", () => {
  it("coerces the landing-page starfield clarify ballot into a valid schema", () => {
    const raw = {
      interactionIntent: "act",
      primaryTaskIntent: "style",
      secondaryTaskIntents: [],
      confidence: 0.72,
      alternatives: [
        { intent: "refactor", confidence: 0.15 },
        { intent: "feature", confidence: 0.1 },
      ],
      needsClarification: true,
      reason: "Ambiguous 'start' elements on the landing page.",
      taskHints: {
        targets: [
          {
            kind: "page",
            value: "landing page",
            explicit: true,
          },
        ],
        constraints: ["Should look professional"],
        requestedOutcomes: ["Landing page appears professional and elegant"],
        clarity: "ambiguous",
        recommendedSkillTags: ["style", "review"],
        ambiguousSlots: [
          {
            id: "target:element",
            question:
              "What do you mean by 'so many start'? Stars, start/CTA buttons, or something else?",
            options: [
              "stars/ratings",
              "start or CTA buttons",
              "decorative elements",
              "other",
            ],
          },
          {
            id: "outcome:style-reference",
            question:
              "Do you have a reference site or specific design direction?",
            options: [
              "minimalist/clean",
              "corporate/formal",
              "luxury/high-end",
              "no specific reference",
            ],
          },
        ],
      },
    };

    const coerced = coerceLlmClassificationJson(raw);
    const parsed = intentClassificationSchema.parse(coerced);

    expect(parsed.interactionIntent).toBe("act");
    expect(parsed.primaryTaskIntent).toBe("style");
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.taskHints?.clarity).toBe("unclear");
    expect(parsed.taskHints?.targets[0]?.kind).toBe("unknown");
    expect(parsed.taskHints?.ambiguousSlots).toHaveLength(2);
    expect(parsed.taskHints?.ambiguousSlots[0]?.kind).toBe("target");
    expect(parsed.taskHints?.ambiguousSlots[0]?.options[0]).toMatchObject({
      label: "stars/ratings",
    });
  });

  it("stripTaskHints keeps the core ballot when evidence is unusable", () => {
    const stripped = stripTaskHints({
      interactionIntent: "act",
      primaryTaskIntent: "style",
      confidence: 0.72,
      needsClarification: true,
      taskHints: { clarity: "not-a-real-value", targets: "bad" },
    });

    const parsed = intentClassificationSchema.parse(stripped);
    expect(parsed.needsClarification).toBe(true);
    expect(parsed.primaryTaskIntent).toBe("style");
    expect(parsed.taskHints).toBeUndefined();
  });

  it("drops invalid alternative intent 'plan' and keeps the refactor ballot", () => {
    const raw = {
      interactionIntent: "act",
      primaryTaskIntent: "refactor",
      secondaryTaskIntents: [],
      confidence: 0.93,
      alternatives: [
        { intent: "feature", confidence: 0.25 },
        { intent: "scaffold", confidence: 0.15 },
        { intent: "plan", confidence: 0.08 },
      ],
      needsClarification: false,
      reason: "POM architecture refactor across test/",
    };

    const coerced = coerceLlmClassificationJson(raw);
    const parsed = intentClassificationSchema.parse(coerced);

    expect(parsed.primaryTaskIntent).toBe("refactor");
    expect(parsed.confidence).toBe(0.93);
    expect(parsed.needsClarification).toBe(false);
    expect(parsed.alternatives.map((a) => a.intent)).toEqual([
      "feature",
      "scaffold",
    ]);
    expect(parsed.alternatives.every((a) => a.intent !== "plan")).toBe(true);
  });

  it("remaps primaryTaskIntent 'plan' to question (interaction ≠ task)", () => {
    const coerced = coerceLlmClassificationJson({
      interactionIntent: "plan",
      primaryTaskIntent: "plan",
      confidence: 0.8,
      needsClarification: false,
      alternatives: [],
    });
    const parsed = intentClassificationSchema.parse(coerced);
    expect(parsed.interactionIntent).toBe("plan");
    expect(parsed.primaryTaskIntent).toBe("question");
  });

  it("salvage stages keep a valid core ballot when alternatives are toxic", () => {
    const stages = salvageLlmClassificationStages({
      interactionIntent: "act",
      primaryTaskIntent: "refactor",
      confidence: 0.93,
      needsClarification: false,
      alternatives: [{ intent: "plan", confidence: 0.08 }],
    });
    const parsed = intentClassificationSchema.parse(stages[0]);
    expect(parsed.primaryTaskIntent).toBe("refactor");
    expect(parsed.alternatives).toEqual([]);
  });
});
