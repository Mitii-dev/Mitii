import { describe, expect, it } from "vitest";

import { executionDecisionSchema } from "../../contracts";
import {
  detectBehavioralAskSignals,
  looksLikeBehavioralAsk,
} from "../../helpers/DetectBehavioralAsk";
import { resolveVerificationRequirement } from "../../helpers/ResolveVerificationRequirement";
import { createUnderstanding } from "../fixtures/decisionCases";

describe("detectBehavioralAskSignals", () => {
  it.each([
    ["Add a POST /api/login endpoint that returns 200", "http"],
    ["The /api/users route returns 404, fix the handler", "http"],
    ["Check it with curl after wiring the route", "http"],
    ["Add a health endpoint to the express app", "http"],
    ["Add a new npm run smoke script", "scripts"],
    ["Make the vitest tests pass for the parser", "tests"],
    ["Write unit tests for formatDate", "tests"],
  ] as const)("detects behavior in %j (%s)", (message, kind) => {
    const signals = detectBehavioralAskSignals(message);
    expect(signals[kind]).toBe(true);
    expect(looksLikeBehavioralAsk(message)).toBe(true);
  });

  it.each([
    "Rename the helper in src/utils/format.ts",
    "Fix the typo in the button label",
    "Run npm install lodash and import it",
    "Update README docs only",
    "",
  ])("does not flag %j", (message) => {
    expect(looksLikeBehavioralAsk(message)).toBe(false);
  });
});

describe("resolveVerificationRequirement behavior evidence", () => {
  const understanding = createUnderstanding({
    primaryTaskIntent: "bugfix",
    taskAnalysis: { complexity: "simple", risk: "low", clarity: "clear" },
  });

  function resolve(message: string) {
    return resolveVerificationRequirement({
      route: "execute",
      mode: "agent",
      understanding,
      maximumWorkspaceEffect: "write",
      message,
    });
  }

  it("adds tests + behavior evidence and a stable reason code for HTTP asks", () => {
    const result = resolve("Add a POST /api/login endpoint that returns 200");
    expect(result.verification.minimumEvidence).toEqual(
      expect.arrayContaining(["diagnostics", "diff_review", "tests", "behavior"]),
    );
    expect(result.reasonCodes).toContain(
      "verification_behavior_evidence_preferred",
    );
    expect(result.verification.allowUnavailable).toBe(false);
  });

  it("leaves minimum evidence unchanged for non-behavioral asks", () => {
    const result = resolve("Rename the helper in src/utils/format.ts");
    expect(result.verification.minimumEvidence).not.toContain("behavior");
    expect(result.reasonCodes).not.toContain(
      "verification_behavior_evidence_preferred",
    );
  });

  it("does not add behavior evidence when verification is not required", () => {
    const result = resolveVerificationRequirement({
      route: "answer",
      mode: "ask",
      understanding,
      maximumWorkspaceEffect: "none",
      message: "Does the /api/login endpoint return 404?",
    });
    expect(result.verification.required).toBe(false);
    expect(result.verification.minimumEvidence).toEqual([]);
  });

  it("emits evidence kinds that the execution decision schema accepts", () => {
    const result = resolve("Make the vitest tests pass for the router");
    const parsed = executionDecisionSchema.shape.verification.safeParse(
      result.verification,
    );
    expect(parsed.success).toBe(true);
    expect(
      executionDecisionSchema.shape.reasonCodes.safeParse(result.reasonCodes)
        .success,
    ).toBe(true);
  });
});
