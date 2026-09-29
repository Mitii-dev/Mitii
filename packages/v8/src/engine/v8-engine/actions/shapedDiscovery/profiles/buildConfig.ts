import { createShapedDiscoveryProfile } from "../factory";

export const buildConfigDiscoveryProfile = createShapedDiscoveryProfile({
  id: "build_config",
  priority: 6,
  strongPatterns: [
    /\b(?:webpack|vite|rollup|esbuild|babel|eslint|prettier|tsconfig|build|compile|bundle|transpile|lint|format)\b/i,
  ],
  weakPatterns: [/\b(?:script|command|npm|yarn|pnpm|setup|boilerplate|config(?:uration)?)\b/i],
  rejectQuery: (query) => {
    if (/\b(?:headless|browser|wdio|playwright|cypress|selenium|e2e)\b/i.test(query)) {
      return true;
    }
    return (
      /\b(?:vitest|jest|karma|mocha|ava)\b/i.test(query) &&
      !/\b(?:webpack|vite|rollup|esbuild|eslint|prettier|tsconfig|babel)\b/i.test(query)
    );
  },
  pathScoreRules: [
    { pattern: /(?:^|\/)webpack\.config/i, score: 100 },
    { pattern: /(?:^|\/)vite\.config/i, score: 100 },
    { pattern: /(?:^|\/)rollup\.config/i, score: 90 },
    { pattern: /(?:^|\/)esbuild\.config/i, score: 90 },
    { pattern: /(?:^|\/)babel\.config/i, score: 90 },
    { pattern: /(?:^|\/)\.eslintrc/i, score: 90 },
    { pattern: /(?:^|\/)\.prettierrc/i, score: 80 },
    { pattern: /(?:^|\/)eslint\.config/i, score: 85 },
    { pattern: /(?:^|\/)tsconfig[\w.-]*\.json$/i, score: 80 },
    { pattern: /(?:^|\/)package\.json$/i, score: 70 },
    { pattern: /(?:^|\/)scripts?\//i, score: 50 },
  ],
  pathDemotionRules: [
    { pattern: /(?:^|\/)node_modules\//i, score: -100 },
    { pattern: /(?:^|\/)dist\//i, score: -60 },
  ],
  includeDefaultDocsDemotion: false,
  globPatterns: [
    "**/webpack.config.*",
    "**/vite.config.*",
    "**/rollup.config.*",
    "**/babel.config.*",
    "**/.eslintrc*",
    "**/eslint.config.*",
    "**/tsconfig.json",
    "**/package.json",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "webpack config",
    "vite config",
    "eslint config",
    "prettier config",
    "tsconfig",
    "package.json scripts",
  ],
  maxSearchQueries: 1,
  minSeedScore: 30,
  maxSeeds: 3,
  preferredPathsLabel:
    "Preferred build/config paths (bundler configs first, then linter/formatter configs):",
  discoverySystemHint:
    "For build/config asks, look at bundler and tool configuration files, not application source.",
});
