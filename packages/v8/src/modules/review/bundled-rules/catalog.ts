/**
 * Mitii-owned bundled review rules.
 * First-match-wins; keep most-specific patterns earlier.
 */
export const BUNDLED_SYSTEM_RULES: ReadonlyArray<{
  pattern: string;
  rule: string;
  source: string;
}> = [
  {
    pattern: ".github/workflows/**/*.{yml,yaml}",
    source: "system",
    rule: `Review GitHub Actions workflows for secrets exposure, unpinned actions,
over-broad permissions, and unsafe pull_request_target usage.`,
  },
  {
    pattern: "**/package.json",
    source: "system",
    rule: `Review package.json for dependency risk, script safety, and accidental
publish/config drift. Flag secrets in scripts.`,
  },
  {
    pattern: "**/*.{ts,tsx,js,jsx,mjs,cjs}",
    source: "system",
    rule: `Review TypeScript/JavaScript for correctness, null/undefined handling,
async races, XSS/injection, and test coverage of changed behavior.`,
  },
  {
    pattern: "**/*.go",
    source: "system",
    rule: `Review Go for error handling, context cancellation, data races, and
resource leaks.`,
  },
  {
    pattern: "**/*.{yml,yaml}",
    source: "system",
    rule: `Review YAML for structural mistakes, unsafe interpolations, and secret leakage.`,
  },
  {
    pattern: "**/*",
    source: "system",
    rule: `Review for correctness, security, readability, tests, and operational risk.
Anchor findings to concrete code. Prefer high-signal issues over nits.`,
  },
];
