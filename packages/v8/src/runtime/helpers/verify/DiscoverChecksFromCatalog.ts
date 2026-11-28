/**
 * S12-DISCOVER — catalog/manifest script hints only (no guessing).
 */

import type { VerificationCheckKind } from "../../contracts/verify/VerificationRequest";
import { omitHeavyVerificationChecks } from "./OmitHeavyVerificationChecks";

export interface CatalogProjectHint {
  id: string;
  scripts?: Record<string, string>;
  testRoots?: readonly string[];
}

export interface DiscoverChecksFromCatalogInput {
  projects?: readonly CatalogProjectHint[];
  /** Explicit opt-in for e2e/emulator scripts. */
  allowHeavy?: boolean;
}

export interface DiscoverChecksFromCatalogResult {
  /** Safe check kinds inferred from scripts. */
  checks: VerificationCheckKind[];
  /** Script names kept after heavy omit. */
  scriptHints: string[];
  omitted: Array<{ candidate: string; reason: string }>;
  unavailableReasons: string[];
  reasonCodes: string[];
}

const KIND_FROM_SCRIPT: Array<{
  pattern: RegExp;
  kind: VerificationCheckKind;
}> = [
  { pattern: /typecheck|tsc|check:types/i, kind: "typecheck" },
  { pattern: /\blint\b|eslint|ruff/i, kind: "lint" },
  { pattern: /\bbuild\b|compile/i, kind: "build" },
  { pattern: /\btest\b|vitest|jest|pytest/i, kind: "tests" },
];

/**
 * Map catalog project scripts → proportional check kinds.
 * Missing scripts → unavailable reasons (never invent commands).
 */
export function discoverChecksFromCatalog(
  input: DiscoverChecksFromCatalogInput,
): DiscoverChecksFromCatalogResult {
  const projects = input.projects ?? [];
  if (projects.length === 0) {
    return {
      checks: ["diagnostics", "diff_review"],
      scriptHints: [],
      omitted: [],
      unavailableReasons: ["catalog_projects_missing"],
      reasonCodes: [
        "verify_discover_no_catalog",
        "verify_discover_fallback_diagnostics",
      ],
    };
  }

  const scriptNames: string[] = [];
  for (const project of projects) {
    for (const name of Object.keys(project.scripts ?? {})) {
      scriptNames.push(name);
    }
  }

  const heavy = omitHeavyVerificationChecks({
    candidates: scriptNames,
    allowHeavy: input.allowHeavy,
  });

  const kinds = new Set<VerificationCheckKind>(["diagnostics", "diff_review"]);
  for (const name of heavy.allowed) {
    for (const rule of KIND_FROM_SCRIPT) {
      if (rule.pattern.test(name)) {
        kinds.add(rule.kind);
      }
    }
  }

  const unavailableReasons: string[] = [];
  if (heavy.allowed.length === 0 && scriptNames.length > 0) {
    unavailableReasons.push("only_heavy_scripts_present");
  }
  if (
    !heavy.allowed.some((n) => /\btest\b|vitest|jest|pytest/i.test(n)) &&
    !input.allowHeavy
  ) {
    // No safe test script — tests unavailable, not invented.
    if (![...kinds].includes("tests")) {
      unavailableReasons.push("tests_script_unavailable");
    }
  }

  return {
    checks: [...kinds],
    scriptHints: heavy.allowed,
    omitted: heavy.omitted,
    unavailableReasons,
    reasonCodes: [
      "verify_discover_from_catalog",
      ...heavy.reasonCodes,
      ...unavailableReasons.map((r) => `verify_unavailable_${r}`),
    ],
  };
}
