import { REVIEW_EFFORTS } from "./constants";
import {
  DEFAULT_REVIEW_EFFORT,
  DEFAULT_REVIEW_GROUPING_BUNDLE_LINE_THRESHOLD,
  DEFAULT_REVIEW_GROUPING_MIN_FILES,
  DEFAULT_REVIEW_HIDE_SEVERITIES,
  DEFAULT_REVIEW_MAX_CONCURRENCY,
  DEFAULT_REVIEW_MAX_DIFF_TOKENS,
  DEFAULT_REVIEW_MAX_FILES_PER_GROUP,
  DEFAULT_REVIEW_MAX_FINDINGS,
  DEFAULT_REVIEW_SCAN_BATCH_SIZE,
} from "./defaults";

type ReviewEffort = (typeof REVIEW_EFFORTS)[number];

/** Effort → max review rounds per group (inspired by OCR effort presets). */
export const REVIEW_EFFORT_ROUNDS: Record<ReviewEffort, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export const REVIEW_POLICY = {
  effort: DEFAULT_REVIEW_EFFORT,
  maxFilesPerGroup: DEFAULT_REVIEW_MAX_FILES_PER_GROUP,
  groupingMinFiles: DEFAULT_REVIEW_GROUPING_MIN_FILES,
  groupingBundleLineThreshold: DEFAULT_REVIEW_GROUPING_BUNDLE_LINE_THRESHOLD,
  maxDiffTokens: DEFAULT_REVIEW_MAX_DIFF_TOKENS,
  maxConcurrency: DEFAULT_REVIEW_MAX_CONCURRENCY,
  scanBatchSize: DEFAULT_REVIEW_SCAN_BATCH_SIZE,
  maxFindings: DEFAULT_REVIEW_MAX_FINDINGS,
  hideSeveritiesByDefault: DEFAULT_REVIEW_HIDE_SEVERITIES,
  /** Extensions Mitii will review by default (language-agnostic core). */
  allowedExtensions: new Set([
    ".ts",
    ".tsx",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
    ".mts",
    ".cts",
    ".go",
    ".py",
    ".rs",
    ".java",
    ".kt",
    ".kts",
    ".c",
    ".h",
    ".cpp",
    ".cc",
    ".cxx",
    ".hpp",
    ".cs",
    ".rb",
    ".php",
    ".swift",
    ".scala",
    ".vue",
    ".svelte",
    ".astro",
    ".json",
    ".json5",
    ".yaml",
    ".yml",
    ".toml",
    ".md",
    ".mdx",
    ".sql",
    ".graphql",
    ".gql",
    ".proto",
    ".tf",
    ".hcl",
    ".sh",
    ".bash",
    ".zsh",
  ]),
  /** Path substrings / prefixes excluded by default. */
  defaultExcludePathPatterns: [
    "node_modules/",
    "dist/",
    "build/",
    ".git/",
    "vendor/",
    "coverage/",
    ".next/",
    "pnpm-lock.yaml",
    "package-lock.json",
    "yarn.lock",
    "*.min.js",
    "*.min.css",
    "*.map",
    "*.lock",
  ],
} as const;

export function effortToRounds(effort: ReviewEffort): number {
  return REVIEW_EFFORT_ROUNDS[effort];
}
