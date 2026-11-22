import { describe, expect, it } from "vitest";

import {
  isLowValueAnswerFollowUp,
  preserveSubstantiveAssistantAnswer,
} from "./preserveSubstantiveAssistantAnswer";

describe("preserveSubstantiveAssistantAnswer", () => {
  it("keeps a security findings report when a mutation blocker follows", () => {
    const audit = [
      "# Security Audit — bill-desk",
      "",
      "## CRITICAL",
      "",
      "**1. Live secrets committed in `.dev.vars`**",
      "- MongoDB credentials and JWT secrets are present.",
      "- Impact: anyone with repo access owns the production DB.",
      "",
      "## HIGH",
      "",
      "**2. JWT tokens never expire**",
      "- jwt.sign has no expiresIn claim.",
    ].join("\n");
    const blocker =
      "**Blocker: no mutation is appropriate for this task.**\n\n" +
      "The request is a read-only security identification.";

    const kept = preserveSubstantiveAssistantAnswer(audit, blocker);
    expect(kept).toContain("Security Audit");
    expect(kept).toContain("Live secrets committed");
    expect(kept).toContain("Blocker: no mutation");
  });

  it("does not erase prior text with a verification wrap-up", () => {
    const prior =
      "Found 13 issues across auth, CORS, and upload handling with file evidence.";
    const summary =
      "No workspace edits were applied in this round, so the verification baseline remains exactly as it was before. The baseline stands at 0 error(s).";
    const kept = preserveSubstantiveAssistantAnswer(prior, summary);
    expect(kept).toContain("Found 13 issues");
    expect(kept).toContain("No workspace edits were applied");
  });

  it("lets a longer substantive continuation replace a short prior", () => {
    const prior = "Looking at auth next.";
    const next = [
      "# Findings",
      "",
      "1. Missing auth on /create-user",
      "2. Broken JWT middleware race",
      "3. Secrets in .dev.vars",
    ].join("\n");
    expect(preserveSubstantiveAssistantAnswer(prior, next)).toBe(next);
  });

  it("marks blockers and verification fluff as low-value follow-ups", () => {
    expect(
      isLowValueAnswerFollowUp(
        "**Blocker: cannot edit without credentials.** Please provide an API key.",
      ),
    ).toBe(true);
    expect(
      isLowValueAnswerFollowUp(
        "No workspace edits were applied. Baseline: 0 error(s).",
      ),
    ).toBe(true);
    expect(
      isLowValueAnswerFollowUp(
        "# Security Audit\n\n## CRITICAL\n\nSecrets are committed.",
      ),
    ).toBe(false);
  });
});
