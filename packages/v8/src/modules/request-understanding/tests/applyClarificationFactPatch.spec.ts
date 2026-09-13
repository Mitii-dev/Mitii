import { describe, expect, it } from "vitest";

import {
  parseClarificationOptionId,
  applyClarificationFactPatch,
  formatClarificationAnswerFromPatch,
} from "../intent/applyClarificationFactPatch";
import type { IntentClassification } from "../intent/schema";

const baseClassification = (): IntentClassification => ({
  interactionIntent: "question",
  primaryTaskIntent: "diagnose",
  secondaryTaskIntents: [],
  confidence: 0.5,
  alternatives: [],
  needsClarification: true,
  taskHints: {
    targets: [],
    constraints: [],
    requestedOutcomes: [],
    recommendedSkillTags: [],
    ambiguousSlots: [],
  },
});

describe("parseClarificationOptionId", () => {
  it("parses target, interaction, and intent ids", () => {
    expect(parseClarificationOptionId("target:src/LoginForm.tsx").targetPath).toBe(
      "src/LoginForm.tsx",
    );
    expect(parseClarificationOptionId("interaction:act").interactionIntent).toBe(
      "act",
    );
    expect(parseClarificationOptionId("intent:bugfix").primaryTaskIntent).toBe(
      "bugfix",
    );
  });
});

describe("applyClarificationFactPatch", () => {
  it("overlays facts and clears needsClarification", () => {
    const next = applyClarificationFactPatch(baseClassification(), {
      optionId: "target:src/A.ts",
      interactionIntent: "act",
      primaryTaskIntent: "bugfix",
      targetPath: "src/A.ts",
    });
    expect(next.needsClarification).toBe(false);
    expect(next.interactionIntent).toBe("act");
    expect(next.primaryTaskIntent).toBe("bugfix");
    expect(next.taskHints?.targets[0]?.value).toBe("src/A.ts");
  });
});

describe("formatClarificationAnswerFromPatch", () => {
  it("prefers label then target", () => {
    expect(
      formatClarificationAnswerFromPatch({
        optionId: "target:x",
        label: "Edit LoginForm",
      }),
    ).toBe("Edit LoginForm");
    expect(
      formatClarificationAnswerFromPatch({
        optionId: "target:src/A.ts",
        targetPath: "src/A.ts",
      }),
    ).toContain("src/A.ts");
  });
});
