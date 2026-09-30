export type ChangeImpactFileBucket = "prod" | "test";

const TEST_PATH_MARKERS = [
  "/tests/",
  "/test/",
  "/src/test/",
  "/spec/",
  "/__tests__/",
  "/__mocks__/",
  "/Tests/",
] as const;

const TEST_FILE_SUFFIXES = [
  ".test.ts",
  ".test.tsx",
  ".test.js",
  ".test.jsx",
  ".test.mts",
  ".test.cts",
  ".spec.ts",
  ".spec.tsx",
  ".spec.js",
  ".spec.jsx",
  "_test.ts",
  "_test.py",
  "_test.go",
  "_test.rs",
  "_test.rb",
  "_spec.rb",
  "Test.java",
  "Tests.java",
  "Test.kt",
  "Test.swift",
  "Tests.swift",
] as const;

/**
 * Partition blast-radius files so model/planning consumers can prefer prod.
 * Heuristic only — based on path conventions, not test-runner config.
 */
export function classifyImpactBucket(
  relativePath: string,
): ChangeImpactFileBucket {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
  const lower = normalized.toLowerCase();
  const withSlash = lower.startsWith("/") ? lower : `/${lower}`;

  for (const marker of TEST_PATH_MARKERS) {
    if (withSlash.includes(marker.toLowerCase())) {
      return "test";
    }
  }

  for (const suffix of TEST_FILE_SUFFIXES) {
    if (
      normalized.endsWith(suffix) ||
      lower.endsWith(suffix.toLowerCase())
    ) {
      return "test";
    }
  }

  const base = normalized.split("/").pop() ?? normalized;
  if (
    /^test[_-]/i.test(base) ||
    /[_-]test\./i.test(base) ||
    /\.tests?\./i.test(base)
  ) {
    return "test";
  }

  return "prod";
}

export function bucketSortKey(bucket: ChangeImpactFileBucket): number {
  return bucket === "prod" ? 0 : 1;
}
