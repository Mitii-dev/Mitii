import { describe, expect, it } from "vitest";

import {
  formatVerificationCritiqueWarnings,
  parseVerificationCritique,
} from "./parseVerificationCritique";

describe("parseVerificationCritique", () => {
  it("parses VTCode-style APPROVE / REJECT markdown", () => {
    const critique = parseVerificationCritique(`
## Verification Result

**Decision:** REJECT

**Issues Found:**
1. [critical] Null deref in src/auth.ts:42
2. [warning] Missing test for logout

**Reasoning:** The change introduces a crash path.
`);

    expect(critique?.decision).toBe("reject");
    expect(critique?.issues).toEqual([
      {
        severity: "critical",
        message: "Null deref in src/auth.ts:42",
      },
      {
        severity: "warning",
        message: "Missing test for logout",
      },
    ]);
    expect(critique?.reasoning).toMatch(/crash path/i);
  });

  it("parses JSON critiques", () => {
    const critique = parseVerificationCritique(
      JSON.stringify({
        decision: "approve",
        issues: [],
        reasoning: "Looks correct.",
      }),
    );
    expect(critique?.decision).toBe("approve");
    expect(critique?.issues).toEqual([]);
  });

  it("returns undefined for empty / non-critique text", () => {
    expect(parseVerificationCritique("")).toBeUndefined();
    expect(parseVerificationCritique("hello world")).toBeUndefined();
  });
});

describe("formatVerificationCritiqueWarnings", () => {
  it("never claims to override an accepting gate", () => {
    const warnings = formatVerificationCritiqueWarnings(
      {
        decision: "reject",
        issues: [{ severity: "critical", message: "bad" }],
      },
      "accept",
    );
    expect(warnings[0]).toMatch(/advisory only; evidence gate accepted/i);
    expect(warnings.some((w) => /LLM critique \[critical\]: bad/.test(w))).toBe(
      true,
    );
  });

  it("notes advisory APPROVE when the gate rejected", () => {
    const warnings = formatVerificationCritiqueWarnings(
      { decision: "approve", issues: [] },
      "reject",
    );
    expect(warnings[0]).toMatch(/advisory only; evidence gate rejected/i);
  });
});
