import { describe, expect, it } from "vitest";

import {
  amendMessageWithClarification,
  buildClarificationPayload,
  resolveClarificationAnswer,
} from "../../../helpers/clarification";
import type { RequestUnderstandingResult } from "../../../../modules/request-understanding";

function baseUnderstanding(
  overrides: Partial<RequestUnderstandingResult> = {},
): RequestUnderstandingResult {
  return {
    intent: {
      primary: "question",
      clarification: {
        question: "Which package should we change?",
        options: [
          { id: "intent:fix_a", label: "Package A", intent: "fix_a" },
          { id: "intent:fix_b", label: "Package B", intent: "fix_b" },
        ],
      },
    },
    ...overrides,
  } as RequestUnderstandingResult;
}

describe("buildClarificationPayload", () => {
  it("builds UI options from intent clarification", () => {
    const payload = buildClarificationPayload(baseUnderstanding());
    expect(payload.clarificationOptions).toHaveLength(2);
    expect(payload.clarificationPrompt).toContain("package");
    expect(payload.clarificationSession?.options[0]?.patch).toBeTruthy();
  });
});

describe("resolveClarificationAnswer", () => {
  it("maps option id through session", () => {
    const payload = buildClarificationPayload(baseUnderstanding());
    const patch = resolveClarificationAnswer(
      payload.clarificationOptions[0]!.id,
      payload.clarificationSession,
    );
    expect(patch).toEqual(payload.clarificationSession!.options[0]!.patch);
  });
});

describe("amendMessageWithClarification", () => {
  it("replaces primary user message while keeping host context", () => {
    const composed = [
      "<<<MITII_USER_MESSAGE>>>",
      "old ask",
      "",
      "<<<MITII_HOST_CONTEXT>>>",
      "cwd=/tmp",
    ].join("\n");
    const amended = amendMessageWithClarification(composed, "Package A");
    expect(amended).toContain("Package A");
    expect(amended).toContain("<<<MITII_HOST_CONTEXT>>>");
    expect(amended).toContain("cwd=/tmp");
  });
});
