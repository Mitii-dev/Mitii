/**
 * S12-SELECT — policy tables for skip/run tests by change class (§12.4).
 * Generic path heuristics only — never fixture/prompt-specific.
 */

export const CHANGE_CLASSES = [
  "docs",
  "types",
  "config",
  "logic",
  "api",
  "unknown",
] as const;

export type ChangeClass = (typeof CHANGE_CLASSES)[number];

export type VerificationCheckKind =
  | "diagnostics"
  | "tests"
  | "typecheck"
  | "lint"
  | "build"
  | "diff_review"
  | "behavior";

export interface ChangeClassSelectPolicy {
  /** Prefer skipping full test suites. */
  skipTests: boolean;
  /** Preferred check kinds (fast-first order applied later). */
  preferredChecks: readonly VerificationCheckKind[];
  reasonCode: string;
}

/**
 * Locked selection table (§12.4) — docs/config skip tests; logic/api run.
 */
export const CHANGE_CLASS_SELECT_TABLE: Record<
  ChangeClass,
  ChangeClassSelectPolicy
> = {
  docs: {
    skipTests: true,
    preferredChecks: ["diagnostics", "diff_review"],
    reasonCode: "verify_select_docs_skip_tests",
  },
  types: {
    skipTests: true,
    preferredChecks: ["diagnostics", "typecheck", "lint", "diff_review"],
    reasonCode: "verify_select_types_light",
  },
  config: {
    skipTests: true,
    preferredChecks: ["diagnostics", "lint", "diff_review"],
    reasonCode: "verify_select_config_light",
  },
  logic: {
    skipTests: false,
    preferredChecks: [
      "diagnostics",
      "typecheck",
      "lint",
      "tests",
      "diff_review",
    ],
    reasonCode: "verify_select_logic_tests",
  },
  api: {
    skipTests: false,
    preferredChecks: [
      "diagnostics",
      "typecheck",
      "lint",
      "tests",
      "build",
      "diff_review",
    ],
    reasonCode: "verify_select_api_tests",
  },
  unknown: {
    skipTests: false,
    preferredChecks: ["diagnostics", "typecheck", "lint", "tests", "diff_review"],
    reasonCode: "verify_select_unknown_conservative",
  },
};

const DOC_EXT = /\.(md|mdx|txt|rst|adoc)$/i;
const TYPE_EXT = /\.(d\.ts)$/i;
const CONFIG_NAME =
  /(^|\/)(\.eslintrc|\.prettierrc|tsconfig|jsconfig|package\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.toml|pyproject\.toml|go\.mod)(\.|$)/i;
const API_HINT = /(^|\/)(api|routes|rpc|graphql|openapi|proto)(\/|$)/i;

export function classifyChangedPaths(
  paths: readonly string[],
): ChangeClass {
  if (paths.length === 0) return "unknown";
  let docs = 0;
  let types = 0;
  let config = 0;
  let api = 0;
  let logic = 0;
  for (const raw of paths) {
    const path = raw.trim();
    if (!path) continue;
    if (DOC_EXT.test(path)) {
      docs += 1;
      continue;
    }
    if (TYPE_EXT.test(path) || path.endsWith(".d.ts")) {
      types += 1;
      continue;
    }
    if (CONFIG_NAME.test(path)) {
      config += 1;
      continue;
    }
    if (API_HINT.test(path)) {
      api += 1;
      continue;
    }
    logic += 1;
  }
  if (api > 0) return "api";
  if (logic > 0) return "logic";
  if (types > 0 && docs + config === paths.filter(Boolean).length - types) {
    return "types";
  }
  if (types > 0 && logic === 0 && api === 0) return "types";
  if (config > 0 && docs + types + logic + api === 0) return "config";
  if (docs > 0 && types + config + logic + api === 0) return "docs";
  if (docs + types + config === paths.filter(Boolean).length) {
    if (types > 0) return "types";
    if (config > 0) return "config";
    return "docs";
  }
  return "unknown";
}

export function selectPolicyForChangedPaths(
  paths: readonly string[],
): ChangeClassSelectPolicy & { changeClass: ChangeClass } {
  const changeClass = classifyChangedPaths(paths);
  return { changeClass, ...CHANGE_CLASS_SELECT_TABLE[changeClass] };
}

/** Fast-first order locked in §12.4. */
export const VERIFY_CHECK_FAST_FIRST: readonly VerificationCheckKind[] = [
  "diagnostics",
  "typecheck",
  "lint",
  "tests",
  "build",
  "diff_review",
  "behavior",
];

export function orderChecksFastFirst(
  checks: readonly VerificationCheckKind[],
): VerificationCheckKind[] {
  const set = new Set(checks);
  return VERIFY_CHECK_FAST_FIRST.filter((c) => set.has(c));
}
