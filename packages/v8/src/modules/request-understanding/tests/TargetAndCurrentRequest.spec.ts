import { describe, expect, it } from "vitest";

import {
  extractCurrentUserRequestForAnalysis,
  extractPrimaryUserMessage,
} from "../intent/extractPrimaryUserMessage";
import type { SuperIntentResult } from "../intent/types";
import { TaskAnalyzer } from "../task-analyzer/TaskAnalyzer";

function baseIntent(
  overrides: Partial<SuperIntentResult["classification"]> = {},
): SuperIntentResult {
  return {
    status: "accepted",
    classification: {
      interactionIntent: "act",
      primaryTaskIntent: "bugfix",
      secondaryTaskIntents: [],
      confidence: 0.9,
      alternatives: [],
      needsClarification: false,
      reason: "test",
      ...overrides,
    },
    scores: [],
    confidenceMargin: 0.2,
    recommendsClarification: false,
    diagnostics: {
      llmPrimaryIntent: "bugfix",
      llmInteractionIntent: "act",
      taskAgreement: true,
      interactionAgreement: true,
      interactionConflict: false,
      agreementBonusApplied: 0,
      disagreementPenaltyApplied: 0,
      minimumConfidence: 0.55,
      minimumMargin: 0.12,
    },
  };
}

describe("extractCurrentUserRequestForAnalysis", () => {
  it("ignores prior-turn file paths when amending understanding", () => {
    const amended = [
      "Prior conversation (for intent routing only; not the live user request):",
      "user: SyntaxError in apps/docs",
      "assistant: Check apps/docs/src/components/live-demo-mui.tsx",
      "",
      "Current user request:",
      "check in @packages and fix it",
    ].join("\n");

    expect(extractCurrentUserRequestForAnalysis(amended)).toBe(
      "check in @packages and fix it",
    );
    expect(extractPrimaryUserMessage(amended)).toContain(
      "Current user request:",
    );
  });
});

describe("TaskAnalyzer target extraction (vitest)", () => {
  it("extracts @packages, multi-segment @crates paths, and error symbols", () => {
    const analyzer = new TaskAnalyzer();
    const result = analyzer.analyze({
      userMessage: [
        "SyntaxError: Identifier 'InputTypes' has already been declared",
        "NameError: name 'load_config' is not defined in @crates/core",
        "check in @packages and fix it",
      ].join("\n"),
      intent: baseIntent(),
    });

    expect(
      result.targets.some(
        (target) =>
          target.kind === "folder" &&
          target.value === "packages" &&
          target.explicit,
      ),
    ).toBe(true);
    expect(
      result.targets.some(
        (target) =>
          target.kind === "folder" &&
          target.value === "crates/core" &&
          target.explicit,
      ),
    ).toBe(true);
    expect(
      result.targets.some(
        (target) =>
          target.kind === "symbol" &&
          target.value === "InputTypes" &&
          target.explicit,
      ),
    ).toBe(true);
  });

  it("extracts layout-neutral multi-segment @mentions", () => {
    const analyzer = new TaskAnalyzer();
    const result = analyzer.analyze({
      userMessage: "look at @backend/api/handlers and fix the panic",
      intent: baseIntent({ primaryTaskIntent: "diagnose" }),
    });

    expect(
      result.targets.some(
        (target) =>
          target.kind === "folder" &&
          target.value === "backend/api/handlers" &&
          target.explicit,
      ),
    ).toBe(true);
  });
});
