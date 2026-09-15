import { describe, expect, it } from "vitest";

import { resolveReviewRules } from "../../actions/ResolveReviewRules";
import { reviewInputSchema } from "../../contracts";

describe("resolveReviewRules", () => {
  it("matches bundled language rules first-match-wins", () => {
    const input = reviewInputSchema.parse({ schemaVersion: 1, files: [] });
    const { rules } = resolveReviewRules({
      paths: ["src/app.ts", "package.json"],
      input,
    });
    expect(rules[0]?.path).toBe("src/app.ts");
    expect(rules[0]?.rule).toMatch(/TypeScript/);
    expect(rules[1]?.rule).toMatch(/package\.json/);
  });

  it("prefers workspace overrides and can merge system rule", () => {
    const input = reviewInputSchema.parse({
      schemaVersion: 1,
      files: [],
      rulesConfig: {
        rules: [
          {
            path: "src/app.ts",
            rule: "Project-specific: no any.",
            mergeSystemRule: true,
          },
        ],
      },
    });
    const { rules, ruleGroups } = resolveReviewRules({
      paths: ["src/app.ts"],
      input,
    });
    expect(rules[0]?.source).toBe("workspace");
    expect(rules[0]?.rule).toContain("Project-specific");
    expect(rules[0]?.rule).toContain("TypeScript");
    expect(ruleGroups).toHaveLength(1);
  });
});
