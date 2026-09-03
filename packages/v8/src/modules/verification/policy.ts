import type { VerificationCheckKind } from "./contracts";
import type { VerificationChangeScope } from "./contracts";

/**
 * Proportional check selection by change scope.
 * Broader scopes expand the kinds considered; discovery still requires
 * trusted project evidence before a check is runnable.
 */
export const CHECK_KINDS_BY_SCOPE: Record<
  VerificationChangeScope,
  readonly VerificationCheckKind[]
> = {
  localized: ["syntax", "diagnostics", "typecheck", "lint", "test", "diff_review"],
  module: [
    "syntax",
    "diagnostics",
    "typecheck",
    "lint",
    "format",
    "test",
    "diff_review",
  ],
  cross_cutting: [
    "syntax",
    "diagnostics",
    "typecheck",
    "lint",
    "format",
    "test",
    "build",
    "diff_review",
  ],
  public_api: [
    "syntax",
    "diagnostics",
    "typecheck",
    "lint",
    "format",
    "test",
    "build",
    "diff_review",
  ],
};

/** Preferred discovery order within an allowed kind set. */
export const CHECK_KIND_PRIORITY: readonly VerificationCheckKind[] = [
  "syntax",
  "diagnostics",
  "typecheck",
  "lint",
  "format",
  "test",
  "build",
  "diff_review",
];

/** Node/JS package.json script names probed per check kind (existence only). */
export const NODE_SCRIPT_CANDIDATES: Record<
  Extract<
    VerificationCheckKind,
    "typecheck" | "lint" | "format" | "test" | "build"
  >,
  readonly string[]
> = {
  typecheck: ["typecheck", "build:types", "check:types", "tsc"],
  lint: ["lint", "eslint", "check"],
  format: ["format", "format:check", "prettier"],
  // Prefer fast unit runners; browser/e2e names are last so discovery only
  // lands on them when no lighter script exists (selection may still omit).
  test: [
    "test",
    "test:unit",
    "vitest",
    "jest",
    "test:e2e",
    "test:desktop",
    "desktop:test",
    "tablet:test",
    "cross:test",
    "e2e",
    "wdio",
  ],
  build: ["build", "compile", "verify"],
};

/** Script names / argv tokens that imply browser or device e2e suites. */
export const BROWSER_E2E_TEST_PATTERN =
  /(?:^|:)(?:e2e|wdio|playwright|cypress|desktop:test|tablet:test|cross:test|test:desktop|test:tablet|test:e2e)(?:$|:)|(?:^|[\s/])(?:wdio|playwright|cypress)(?:$|[\s.])/i;

export const PLACEHOLDER_TEST_SCRIPT =
  /no test specified|error:\s*no test|exit\s+1/i;

export const MISSING_TOOL_PATTERNS =
  /\b(command not found|enoent|not recognized as an internal or external command|cannot find module|can't resolve|module not found)\b/i;
