import { describe, expect, it } from "vitest";

import {
  boundPreferredPathsForPlanScope,
  planScopeProcessHint,
  scorePathForPlanScope,
} from "./planScopeBounds";

describe("boundPreferredPathsForPlanScope", () => {
  const paths = [
    "packages/runner/src/score.ts",
    "cases/auth/oracle.test.ts",
    ".github/workflows/validate.yml",
    "README.md",
    "apps/cli/src/main.ts",
  ];

  it("keeps case/oracle paths for scope A", () => {
    expect(boundPreferredPathsForPlanScope(paths, "a")).toEqual([
      "cases/auth/oracle.test.ts",
    ]);
  });

  it("keeps CI/validate paths for scope B", () => {
    expect(boundPreferredPathsForPlanScope(paths, "b")).toContain(
      ".github/workflows/validate.yml",
    );
  });

  it("keeps packages/apps for scope C", () => {
    const bound = boundPreferredPathsForPlanScope(paths, "c");
    expect(bound).toContain("packages/runner/src/score.ts");
    expect(bound).toContain("apps/cli/src/main.ts");
  });

  it("falls back to a small original slice when nothing matches", () => {
    expect(
      boundPreferredPathsForPlanScope(["unrelated/foo.ts", "other/bar.ts"], "a"),
    ).toEqual(["unrelated/foo.ts", "other/bar.ts"]);
  });
});

describe("scorePathForPlanScope", () => {
  it("scores oracle higher for A than for C", () => {
    expect(scorePathForPlanScope("cases/x/oracle.test.ts", "a")).toBeGreaterThan(
      scorePathForPlanScope("cases/x/oracle.test.ts", "c"),
    );
  });
});

describe("planScopeProcessHint", () => {
  it("stays within Planning processHints length", () => {
    expect(planScopeProcessHint("a").length).toBeLessThanOrEqual(120);
    expect(planScopeProcessHint("b").length).toBeLessThanOrEqual(120);
    expect(planScopeProcessHint("c").length).toBeLessThanOrEqual(120);
  });
});
