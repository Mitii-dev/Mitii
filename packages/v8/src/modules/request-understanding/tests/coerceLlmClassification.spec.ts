import { describe, expect, it } from "vitest";
import { intentClassificationSchema } from "../intent/schema";
import {
  coerceLlmClassificationJson,
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
});
