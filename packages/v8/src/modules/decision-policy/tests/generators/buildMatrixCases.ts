import { INTENT_CONSTANTS } from "../../../request-understanding/intent/constants";
import type { GoldenDecisionCase } from "../fixtures/decisionFixtureTypes";
import { createTarget, createUnderstanding } from "../fixtures/decisionFixtureHelpers";

const SCOPES = [
  "single_location",
  "multi_file",
  "package",
  "repository",
  "workspace",
  "unknown",
] as const;

const MODES = ["ask", "plan", "agent"] as const;

const ORIGINS = ["user", "automation", "api"] as const;

/** Intents paired with deterministic message templates for matrix generation. */
const INTENT_MESSAGES: Record<string, string> = {
  bugfix: "Fix the null pointer in src/auth/login.ts",
  feature: "Add OAuth callback handler in src/auth/callback.ts",
  refactor: "Extract helpers from src/forms/validate.ts",
  optimize: "Optimize render path in src/components/List.tsx",
  diagnose: "Why is the build failing? Do not change any files.",
  review: "Review the auth module for security risks.",
  audit: "Audit logging coverage across the service layer.",
  trace: "Trace where the request id is dropped in src/api/handler.ts",
  question: "How does session refresh work in this codebase?",
  docs: "Document the repository state publishing flow.",
  migrate: "Migrate legacy indexing across the repository.",
  scaffold: "Scaffold a new CLI package under packages/cli",
  schema: "Add database migration for user_preferences table",
  mock: "Add mock adapter for the payment gateway in tests/",
  config: "Update CI config in .github/workflows/ci.yml",
  dependency: "Upgrade lodash in package.json",
  security: "Patch dependency vulnerabilities in package.json",
  style: "Apply consistent spacing in src/components/Header.tsx",
  format: "Run formatter on src/utils/format.ts",
  test: "Add unit tests for src/utils/format.ts",
};

function expectedForMatrix(params: {
  mode: (typeof MODES)[number];
  intent: string;
  scope: (typeof SCOPES)[number];
}): GoldenDecisionCase["expected"] {
  const { mode, intent, scope } = params;

  if (mode === "plan") {
    return {
      route: "plan",
      planningDepth: "visible",
      maximumWorkspaceEffect: "read",
    };
  }

  if (mode === "ask") {
    if (
      intent === "diagnose" ||
      intent === "review" ||
      intent === "audit" ||
      intent === "trace"
    ) {
      return { route: "diagnose", maximumWorkspaceEffect: "read" };
    }
    if (
      intent === "question" ||
      intent === "docs" ||
      intent === "bugfix" ||
      intent === "feature" ||
      intent === "refactor" ||
      intent === "optimize" ||
      intent === "style" ||
      intent === "format" ||
      intent === "test" ||
      intent === "mock" ||
      intent === "config" ||
      intent === "dependency" ||
      intent === "security" ||
      intent === "migrate" ||
      intent === "scaffold" ||
      intent === "schema" ||
      scope === "repository" ||
      scope === "workspace" ||
      scope === "package" ||
      scope === "multi_file" ||
      scope === "single_location"
    ) {
      return { route: "repository_answer", maximumWorkspaceEffect: "read" };
    }
    return { route: "direct_answer", maximumWorkspaceEffect: "none" };
  }

  // agent
  if (
    intent === "diagnose" ||
    intent === "review" ||
    intent === "audit" ||
    intent === "trace"
  ) {
    return { route: "diagnose", maximumWorkspaceEffect: "read" };
  }
  if (intent === "question" || intent === "docs") {
    return { route: "repository_answer", maximumWorkspaceEffect: "read" };
  }
  if (
    intent === "migrate" ||
    intent === "scaffold" ||
    (intent === "feature" && (scope === "package" || scope === "repository")) ||
    (intent === "schema" && (scope === "repository" || scope === "workspace"))
  ) {
    return {
      route: "execute",
      maximumWorkspaceEffect: "write",
      planningDepth: "visible",
    };
  }
  return {
    route: "execute",
    maximumWorkspaceEffect: "write",
  };
}

/**
 * Builds pairwise-style matrix cases for scale testing.
 * Full intent × mode × scope grid (minus incoherent combos), capped by limit.
 */
export function buildMatrixCases(limit = 200): GoldenDecisionCase[] {
  const cases: GoldenDecisionCase[] = [];
  const intents = INTENT_CONSTANTS.TASK_INTENTS.filter(
    (intent) => intent in INTENT_MESSAGES,
  );

  for (const mode of MODES) {
    for (const intent of intents) {
      for (const scope of SCOPES) {
        if (cases.length >= limit) {
          return cases;
        }

        if (mode === "plan" && (intent === "diagnose" || intent === "trace")) {
          continue;
        }

        const origin = ORIGINS[cases.length % ORIGINS.length];
        const id = `matrix-${mode}-${intent}-${scope}`;
        const message = INTENT_MESSAGES[intent] ?? `Handle ${intent} task`;
        const complexity =
          scope === "single_location"
            ? "simple"
            : scope === "multi_file"
              ? "moderate"
              : "complex";
        const risk =
          intent === "security" || intent === "schema" ? "high" : "low";

        cases.push({
          id,
          category: "matrix",
          mode,
          origin,
          message,
          understanding: createUnderstanding({
            primaryTaskIntent: intent as GoldenDecisionCase["understanding"]["intent"]["classification"]["primaryTaskIntent"],
            interactionIntent:
              mode === "plan"
                ? "plan"
                : intent === "question" ||
                    intent === "docs" ||
                    intent === "diagnose" ||
                    intent === "review" ||
                    intent === "audit" ||
                    intent === "trace"
                  ? "question"
                  : "act",
            taskAnalysis: {
              scope,
              complexity,
              risk,
              recommendsRepositoryDiscovery:
                scope !== "single_location" && scope !== "unknown",
              recommendsPlanning: scope === "package" || scope === "repository",
              recommendsVerification: intent === "bugfix" || intent === "feature",
              targets:
                scope === "single_location"
                  ? [createTarget("src/example.ts")]
                  : [],
            },
          }),
          expected: expectedForMatrix({ mode, intent, scope }),
        });
      }
    }
  }

  return cases;
}
