import { describe, expect, it } from "vitest";

import {
  requiresStructuredReviewFindings,
  buildIncompleteReviewRecoveryMessage,
} from "../incompleteReviewFindings";

describe("requiresStructuredReviewFindings", () => {
  it("is true when review_findings_structured is present", () => {
    expect(
      requiresStructuredReviewFindings([
        "diagnosis_readonly",
        "review_findings_structured",
      ]),
    ).toBe(true);
  });

  it("is false otherwise", () => {
    expect(requiresStructuredReviewFindings(["diagnosis_readonly"])).toBe(
      false,
    );
    expect(requiresStructuredReviewFindings(undefined)).toBe(false);
  });
});

describe("buildIncompleteReviewRecoveryMessage", () => {
  it("requires emit_review_finding and forbids prose-only finish", () => {
    const message = buildIncompleteReviewRecoveryMessage();
    expect(message).toContain("emit_review_finding");
    expect(message).toMatch(/prose-only/i);
    expect(message).toMatch(/at least once/i);
  });
});
