import { createShapedDiscoveryProfile } from "../factory";

export const testingDiscoveryProfile = createShapedDiscoveryProfile({
  id: "testing",
  priority: 8,
  strongPatterns: [
    /\b(?:unit\s+test|integration\s+test|test\s+suite|mock(?:ing)?|stub(?:bing)?|fixture)\b/i,
    /\b(?:jest|vitest|mocha|pytest|junit|playwright|cypress)\b/i,
    /\b(?:coverage|assert(?:ion)?|expect\()\b/i,
  ],
  weakPatterns: [
    /\b(?:test|spec|mock|stub|fixture|describe|it\()\b/i,
  ],
  rejectQuery: (query) =>
    /\b(?:wdio|webdriver|selenium|headless\s+browser|browser\s+test)\b/i.test(
      query,
    ),
  pathScoreRules: [
    { pattern: /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/i, score: 95 },
    { pattern: /(?:^|\/)(?:__tests__|tests?|spec)\//i, score: 90 },
    { pattern: /(?:^|\/)(?:mocks?|fixtures?)\//i, score: 80 },
    { pattern: /(?:^|\/)vitest\.config/i, score: 85 },
    { pattern: /(?:^|\/)jest\.config/i, score: 85 },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)node_modules\//i, score: -100 }],
  includeDefaultSpecDemotion: false,
  globPatterns: [
    "**/*.{test,spec}.{ts,tsx,js,jsx}",
    "**/__tests__/**/*.{ts,tsx,js,jsx}",
    "**/mocks/**/*.{ts,js}",
    "**/vitest.config.*",
    "**/jest.config.*",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "describe it expect",
    "vi.mock",
    "jest.mock",
    "test fixture",
  ],
  maxSearchQueries: 1,
  minSeedScore: 35,
  maxSeeds: 5,
  preferredPathsLabel:
    "Preferred testing paths (existing specs/mocks first, then test config):",
  discoverySystemHint:
    "For testing/mocks asks, extend existing specs and shared fixtures; do not \"fix\" production by weakening assertions.",
});
