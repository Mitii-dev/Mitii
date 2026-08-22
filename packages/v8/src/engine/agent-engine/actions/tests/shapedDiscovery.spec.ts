import { describe, expect, it, vi } from "vitest";

import { collectPreferredPlanningPaths } from "../planningContext";
import {
  apiBackendDiscoveryProfile,
  authDiscoveryProfile,
  browserTestRunnerDiscoveryProfile,
  buildConfigDiscoveryProfile,
  cappedGlobPatterns,
  cappedSearchQueries,
  ciCdDiscoveryProfile,
  collectShapedDiscoveryHits,
  databaseDiscoveryProfile,
  extractGlobPathsFromToolOutput,
  frontendComponentDiscoveryProfile,
  matchesBrowserTestRunnerQuery,
  rankPathsForShapedDiscovery,
  resolveShapedDiscoveryProfile,
  selectShapedDiscoverySeeds,
  SHAPED_DISCOVERY_PROFILES,
} from "../shapedDiscovery";

describe("SHAPED_DISCOVERY_PROFILES registry", () => {
  it("registers all domain profiles from project-goals/ref/profiles.md", () => {
    expect(SHAPED_DISCOVERY_PROFILES.map((profile) => profile.id)).toEqual([
      "browser_test_runner",
      "ci_cd",
      "auth",
      "api_backend",
      "database",
      "frontend_component",
      "build_config",
    ]);
  });
});

describe("resolveShapedDiscoveryProfile", () => {
  it("matches browser/test-runner asks via the browser profile", () => {
    expect(
      resolveShapedDiscoveryProfile(
        "Can you plan for implementing headless test cases",
      )?.id,
    ).toBe("browser_test_runner");
    expect(resolveShapedDiscoveryProfile("update wdio capabilities")?.id).toBe(
      "browser_test_runner",
    );
    expect(
      resolveShapedDiscoveryProfile("refactor the payments ledger module"),
    ).toBeUndefined();
  });

  it("does not match pure unit-test runner asks", () => {
    expect(
      resolveShapedDiscoveryProfile("add jest unit tests for login service"),
    ).toBeUndefined();
    expect(resolveShapedDiscoveryProfile("fix vitest configuration")).toBeUndefined();
  });

  it("resolves additional domain profiles", () => {
    expect(
      resolveShapedDiscoveryProfile("add a REST endpoint for payments")?.id,
    ).toBe("api_backend");
    expect(
      resolveShapedDiscoveryProfile("create a prisma migration for users")?.id,
    ).toBe("database");
    expect(
      resolveShapedDiscoveryProfile("add a loading spinner component to LoginForm")?.id,
    ).toBe("frontend_component");
    expect(
      resolveShapedDiscoveryProfile("update github actions deploy pipeline")?.id,
    ).toBe("ci_cd");
    expect(
      resolveShapedDiscoveryProfile("implement jwt authentication middleware")?.id,
    ).toBe("auth");
    expect(
      resolveShapedDiscoveryProfile("fix vite build configuration")?.id,
    ).toBe("build_config");
  });

  it("prefers browser profile over build config for headless asks", () => {
    expect(
      resolveShapedDiscoveryProfile("configure headless chrome in wdio")?.id,
    ).toBe("browser_test_runner");
  });
});

describe("matchesBrowserTestRunnerQuery", () => {
  it("rejects browser-unrelated weak combinations", () => {
    expect(matchesBrowserTestRunnerQuery("browser login page")).toBe(false);
    expect(matchesBrowserTestRunnerQuery("test cases for login")).toBe(false);
  });
});

describe("domain profile path ranking", () => {
  it("prefers testConfig and named wdio configs over generic wdio.conf.ts", () => {
    const profile = browserTestRunnerDiscoveryProfile;
    expect(profile.scorePath("test/shared/config/testConfig.ts")).toBeGreaterThan(
      profile.scorePath("wdio.conf.ts"),
    );
    expect(profile.scorePath("README.md")).toBeLessThan(profile.minSeedScore!);
  });

  it("prefers routes/controllers for api asks", () => {
    expect(apiBackendDiscoveryProfile.scorePath("src/routes/payments.ts")).toBeGreaterThan(
      apiBackendDiscoveryProfile.scorePath("README.md"),
    );
  });

  it("prefers migrations/models for database asks", () => {
    expect(databaseDiscoveryProfile.scorePath("prisma/migrations/001.sql")).toBeGreaterThan(
      databaseDiscoveryProfile.scorePath("src/utils/helpers.ts"),
    );
  });

  it("prefers workflow files for ci/cd asks", () => {
    expect(
      ciCdDiscoveryProfile.scorePath(".github/workflows/ci.yml"),
    ).toBeGreaterThan(ciCdDiscoveryProfile.scorePath("README.md"));
  });

  it("prefers auth folders for auth asks", () => {
    expect(authDiscoveryProfile.scorePath("src/auth/jwt.ts")).toBeGreaterThan(
      authDiscoveryProfile.scorePath("src/pages/login.tsx"),
    );
  });

  it("prefers component folders for frontend asks", () => {
    expect(
      frontendComponentDiscoveryProfile.scorePath("src/components/LoginForm.tsx"),
    ).toBeGreaterThan(frontendComponentDiscoveryProfile.scorePath("README.md"));
  });

  it("prefers bundler configs for build asks", () => {
    expect(buildConfigDiscoveryProfile.scorePath("vite.config.ts")).toBeGreaterThan(
      buildConfigDiscoveryProfile.scorePath("src/main.ts"),
    );
  });
});

describe("profile discovery budget caps", () => {
  it("limits glob and search lists to profile caps", () => {
    expect(cappedGlobPatterns(browserTestRunnerDiscoveryProfile)).toHaveLength(3);
    expect(cappedSearchQueries(browserTestRunnerDiscoveryProfile)).toHaveLength(1);
    expect(cappedGlobPatterns(apiBackendDiscoveryProfile)).toHaveLength(3);
    expect(cappedSearchQueries(authDiscoveryProfile)).toHaveLength(1);
  });

  it("runs at most maxGlobPatterns + maxSearchQueries tool calls", async () => {
    const executeTool = vi.fn(async () => ({ matches: [] }));
    await collectShapedDiscoveryHits({
      profile: browserTestRunnerDiscoveryProfile,
      shouldContinue: () => true,
      executeTool,
    });
    expect(executeTool).toHaveBeenCalledTimes(4);
  });
});

describe("selectShapedDiscoverySeeds", () => {
  it("returns capability config paths from glob hits", () => {
    const selected = selectShapedDiscoverySeeds(
      browserTestRunnerDiscoveryProfile,
      ["wdio.conf.ts", "test/shared/config/testConfig.ts", "README.md"],
      ["test/pageObjects/BasePage.ts"],
    );
    expect(selected[0]).toBe("test/shared/config/testConfig.ts");
    expect(selected).not.toContain("README.md");
  });

  it("extracts paths from glob tool output", () => {
    const paths = extractGlobPathsFromToolOutput({
      matches: [
        { path: "test/shared/config/testConfig.ts" },
        { path: "wdio.desktop.conf.ts" },
      ],
    });
    expect(paths).toEqual([
      "test/shared/config/testConfig.ts",
      "wdio.desktop.conf.ts",
    ]);
  });
});

describe("collectPreferredPlanningPaths shaped ranking", () => {
  it("ranks paths when a shaped profile matches the query", () => {
    const paths = collectPreferredPlanningPaths({
      query: "plan headless test cases",
      contextPaths: ["wdio.conf.ts", "test/shared/config/testConfig.ts"],
      priorPathHints: [],
    });
    expect(paths[0]).toBe("test/shared/config/testConfig.ts");
  });

  it("ranks api paths for backend asks", () => {
    const paths = collectPreferredPlanningPaths({
      query: "add REST endpoint for refunds",
      contextPaths: ["README.md", "src/routes/payments.ts", "src/utils/helpers.ts"],
      priorPathHints: [],
    });
    expect(paths[0]).toBe("src/routes/payments.ts");
  });

  it("does not rank when no profile matches", () => {
    const paths = collectPreferredPlanningPaths({
      query: "refactor the payments ledger module",
      contextPaths: ["wdio.conf.ts", "test/shared/config/testConfig.ts"],
      priorPathHints: [],
    });
    expect(paths[0]).toBe("wdio.conf.ts");
  });
});
