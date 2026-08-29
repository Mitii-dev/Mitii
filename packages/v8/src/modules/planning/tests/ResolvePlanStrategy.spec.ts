import { describe, expect, it } from "vitest";

import { PLANNING_SCHEMA_VERSION } from "../constants";
import type { PlanningParsedInput } from "../contracts";
import { resolvePlanStrategyRules } from "../actions/ResolvePlanStrategy";

/**
 * Regression coverage for a real logged run: "@packages/mui-builder please
 * fix all ts issues in this package" spent a wasted discovery pass because
 * diagnostic paths arrived unprefixed relative to the package, so scope
 * matching against the explicit "packages/mui-builder" target never
 * overlapped. Verification now normalizes those paths (see
 * NormalizeDiagnostics.spec.ts); this confirms Planning correctly resolves
 * to follow_evidence once the diagnostics are workspace-relative.
 */
function input(
  overrides: Partial<PlanningParsedInput> = {},
): PlanningParsedInput {
  return {
    schemaVersion: PLANNING_SCHEMA_VERSION,
    query: "@packages/mui-builder \nplease fix all ts issues in this package",
    mode: "agent",
    route: "execute",
    planningDepth: "visible",
    explorationDepth: "auto",
    evidence: {
      primaryIntent: "bugfix",
      secondaryIntents: [],
      scope: "package",
      complexity: "moderate",
      risk: "low",
      clarity: "clear",
      targets: [
        { kind: "folder", value: "packages/mui-builder", explicit: true },
      ],
      constraints: [],
      requestedOutcomes: ["Fix all TypeScript errors"],
      recommendsPlanning: true,
      recommendsVerification: true,
      changeImpact: ["code"],
    },
    buildEvidence: {
      phase: "before",
      summary: "2 error(s); failed checks: typecheck",
      failedChecks: ["typecheck"],
      diagnostics: [
        {
          path: "packages/mui-builder/src/fields/field-radio/field-radio.tsx",
          severity: "error",
          message:
            "Type '{ children: Element[] | undefined; }' is not assignable to type 'RadioGroupProps'.",
          startLine: 24,
          source: "compiler",
          code: "TS2322",
        },
        {
          path: "packages/mui-builder/src/FormBuilder.tsx",
          severity: "error",
          message: "Module \"./types\" has no exported member 'FormBuilderProps'.",
          startLine: 7,
          source: "compiler",
          code: "TS2305",
        },
      ],
    },
    budgetTokens: 1_600,
    ...overrides,
  };
}

describe("resolvePlanStrategyRules", () => {
  it("resolves to follow_evidence, skipping discovery, for a package-scoped repair with correctly-prefixed diagnostics", () => {
    const decision = resolvePlanStrategyRules(input());

    expect(decision.strategy).toBe("follow_evidence");
    expect(decision.skipDiscover).toBe(true);
    expect(decision.useBuildEvidence).toBe(true);
  });

  it("treats project-relative diagnostic paths as in-scope under an explicit package target", () => {
    const decision = resolvePlanStrategyRules(
      input({
        buildEvidence: {
          phase: "before",
          summary: "2 error(s); failed checks: typecheck",
          failedChecks: ["typecheck"],
          diagnostics: [
            {
              path: "src/fields/field-radio/field-radio.tsx",
              severity: "error",
              message: "project-relative path from a package typecheck",
              startLine: 24,
              source: "compiler",
              code: "TS2322",
            },
          ],
        },
      }),
    );

    expect(decision.strategy).toBe("follow_evidence");
    expect(decision.skipDiscover).toBe(true);
    expect(decision.useBuildEvidence).toBe(true);
  });

  it("uses follow_evidence for a broad package repair even when the snapshot has no diagnostics", () => {
    const decision = resolvePlanStrategyRules(
      input({
        query: "@packages/mui-builder\nPlease fix all the ts erros in this package",
        buildEvidence: undefined,
      }),
    );

    expect(decision.strategy).toBe("follow_evidence");
    expect(decision.skipDiscover).toBe(true);
  });

  it("resolves to clarify when clarity is unclear, even with in-scope repair evidence", () => {
    const decision = resolvePlanStrategyRules(
      input({ evidence: { ...input().evidence, clarity: "unclear" } }),
    );

    expect(decision.strategy).toBe("clarify");
    expect(decision.skipDiscover).toBe(true);
  });

  it("resolves to plan_from_ask for a Quick exploration depth even with wide scope", () => {
    const decision = resolvePlanStrategyRules(
      input({
        explorationDepth: "quick",
        evidence: { ...input().evidence, primaryIntent: "feature" },
        buildEvidence: undefined,
      }),
    );

    expect(decision.strategy).toBe("plan_from_ask");
    expect(decision.skipDiscover).toBe(true);
  });

  it("resolves to discover_and_plan for a Deep/Auto wide-scope feature ask with no repair evidence", () => {
    const decision = resolvePlanStrategyRules(
      input({
        explorationDepth: "deep",
        evidence: {
          ...input().evidence,
          primaryIntent: "feature",
          scope: "repository",
        },
        buildEvidence: undefined,
      }),
    );

    expect(decision.strategy).toBe("discover_and_plan");
  });

  it("resolves to plan_from_ask for a narrow feature ask with unrelated out-of-scope errors", () => {
    const decision = resolvePlanStrategyRules(
      input({
        query: "add a loading spinner to LoginForm.tsx",
        evidence: {
          ...input().evidence,
          primaryIntent: "feature",
          scope: "single_location",
          complexity: "simple",
          recommendsPlanning: false,
          targets: [
            { kind: "file", value: "src/LoginForm.tsx", explicit: true },
          ],
        },
      }),
    );

    expect(decision.strategy).toBe("plan_from_ask");
    expect(decision.useBuildEvidence).toBe(false);
  });

  it("skips rediscovery when knownPathHints already name file surfaces", () => {
    const decision = resolvePlanStrategyRules(
      input({
        explorationDepth: "auto",
        query: "can you plan the above for implementation",
        evidence: {
          ...input().evidence,
          primaryIntent: "feature",
          scope: "multi_file",
          complexity: "simple",
          recommendsPlanning: true,
          targets: [],
        },
        buildEvidence: undefined,
        knownPathHints: ["test/shared/config/testConfig.ts"],
      }),
    );

    expect(decision.strategy).toBe("plan_from_ask");
    expect(decision.skipDiscover).toBe(true);
  });

  it("still rediscovers on deep exploration even with knownPathHints", () => {
    const decision = resolvePlanStrategyRules(
      input({
        explorationDepth: "deep",
        evidence: {
          ...input().evidence,
          primaryIntent: "feature",
          scope: "multi_file",
        },
        buildEvidence: undefined,
        knownPathHints: ["src/auth/session.ts"],
      }),
    );

    expect(decision.strategy).toBe("discover_and_plan");
  });
});
