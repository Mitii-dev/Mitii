import {
  CHANGE_IMPACT_SCHEMA_VERSION,
} from "../constants";
import {
  ChangeImpactError,
  changeImpactSpilloverInputSchema,
  changeImpactSpilloverResultSchema,
} from "../contracts";
import type {
  ChangeImpactParsedSpilloverInput,
  ChangeImpactResult,
  ChangeImpactSpilloverResult,
} from "../contracts";
import { packageRootFromPath } from "../internal/packagePathHelpers";
import { normalizeRelativePath } from "../internal/impactGraphHelpers";

/**
 * Compare affected packages against an expected set. Spillover means impact
 * escaped the declared package boundary.
 */
export function evaluateSpillover(
  input: ChangeImpactParsedSpilloverInput | unknown,
): ChangeImpactSpilloverResult {
  let parsed: ChangeImpactParsedSpilloverInput;
  try {
    parsed = changeImpactSpilloverInputSchema.parse(input);
  } catch (error) {
    throw new ChangeImpactError(
      "invalid_input",
      "Spillover input failed schema validation.",
      {
        cause: error instanceof Error ? error.message : String(error),
      },
    );
  }

  const expected = new Set(
    parsed.expectedPackages.map((value) => normalizeToken(value)),
  );
  const observed = uniqueNormalized([
    ...parsed.affectedPackageIds,
    ...parsed.affectedPackageNames,
    ...parsed.affectedPackageRoots,
  ]);

  const matchedPackages: string[] = [];
  const spilloverPackages: string[] = [];
  for (const packageToken of observed) {
    if (matchesExpected(packageToken, expected)) {
      matchedPackages.push(packageToken);
    } else {
      spilloverPackages.push(packageToken);
    }
  }

  const withinExpected = spilloverPackages.length === 0;
  return changeImpactSpilloverResultSchema.parse({
    schemaVersion: CHANGE_IMPACT_SCHEMA_VERSION,
    withinExpected,
    expectedPackages: [...expected],
    matchedPackages: matchedPackages.sort((a, b) => a.localeCompare(b)),
    spilloverPackages: spilloverPackages.sort((a, b) => a.localeCompare(b)),
    reasonCodes: [withinExpected ? "spillover_clean" : "spillover_detected"],
    warnings: withinExpected
      ? []
      : [
          {
            code: "spillover_detected",
            message: `Impact reached ${spilloverPackages.length} package(s) outside the expected set.`,
          },
        ],
  });
}

/**
 * Build spillover input tokens from a published impact result.
 */
export function spilloverTokensFromResult(
  result: Pick<
    ChangeImpactResult,
    "packagesAffected" | "affectedFiles"
  >,
): {
  affectedPackageIds: string[];
  affectedPackageNames: string[];
  affectedPackageRoots: string[];
} {
  const affectedPackageIds = result.packagesAffected.map(
    (project) => project.projectId,
  );
  const affectedPackageNames = result.packagesAffected.map(
    (project) => project.name,
  );
  const roots = new Set<string>();
  for (const file of result.affectedFiles) {
    const root = packageRootFromPath(file.relativePath);
    if (root) roots.add(root);
  }
  return {
    affectedPackageIds,
    affectedPackageNames,
    affectedPackageRoots: [...roots],
  };
}

function matchesExpected(
  observed: string,
  expected: ReadonlySet<string>,
): boolean {
  if (expected.has(observed)) return true;
  for (const candidate of expected) {
    if (observed === candidate) return true;
    if (
      observed.startsWith(`${candidate}/`) ||
      candidate.startsWith(`${observed}/`)
    ) {
      return true;
    }
    // Project ids often embed package roots/names as `root:packages:sdk:name`.
    if (
      observed.includes(`:${candidate}:`) ||
      observed.endsWith(`:${candidate}`) ||
      observed.startsWith(`${candidate}:`)
    ) {
      return true;
    }
  }
  return false;
}

function normalizeToken(value: string): string {
  return normalizeRelativePath(value).toLowerCase();
}

function uniqueNormalized(values: readonly string[]): string[] {
  return [...new Set(values.map((value) => normalizeToken(value)).filter(Boolean))];
}
