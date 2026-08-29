import { describe, expect, it } from "vitest";

import {
  buildPlanningQuery,
  collectPreferredPlanningPaths,
  extractPriorPathHints,
  isPlanningFollowUp,
} from "../planningContext";

describe("buildPlanningQuery", () => {
  it("merges prior user + assistant when asked to plan the above", () => {
    const query = buildPlanningQuery("can you plan the above for implementation", [
      {
        role: "user",
        content: "is headless implemented in these test cases?",
      },
      {
        role: "assistant",
        content:
          "No. Edit `test/shared/config/testConfig.ts` and add goog:chromeOptions args with --headless=new.",
      },
    ]);
    expect(query).toContain("is headless implemented");
    expect(query).toContain("Follow-up: can you plan the above for implementation");
    expect(query).toContain("test/shared/config/testConfig.ts");
  });

  it("leaves a long standalone ask unchanged", () => {
    const ask =
      "Add authentication middleware to the payments service with rate limiting";
    expect(buildPlanningQuery(ask, [])).toBe(ask);
  });
});

describe("extractPriorPathHints / collectPreferredPlanningPaths", () => {
  it("extracts file paths from prior assistant guidance", () => {
    const hints = extractPriorPathHints([
      {
        role: "assistant",
        content:
          "Edit `test/shared/config/testConfig.ts` and review wdio.desktop.conf.ts before changing README.md.",
      },
    ]);
    expect(hints).toContain("test/shared/config/testConfig.ts");
    expect(hints).toContain("wdio.desktop.conf.ts");
  });

  it("does not treat cold plan-for-implementing prompts as follow-ups", () => {
    expect(
      isPlanningFollowUp(
        "Can you plan for implementing headless test in this project",
        [],
      ),
    ).toBe(false);
  });

  it("prefers explicit targets, then context, then prior hints", () => {
    const paths = collectPreferredPlanningPaths({
      evidenceTargets: [
        { kind: "file", value: "src/a.ts", explicit: true },
        { kind: "folder", value: "src", explicit: true },
      ],
      contextPaths: ["src/b.ts", "README.md"],
      priorPathHints: ["src/c.ts", "src/a.ts"],
    });
    expect(paths[0]).toBe("src/a.ts");
    expect(paths).toContain("src/b.ts");
    expect(paths).toContain("src/c.ts");
  });
});
