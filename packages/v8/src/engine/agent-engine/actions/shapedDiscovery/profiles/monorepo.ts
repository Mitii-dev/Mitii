import { createShapedDiscoveryProfile } from "../factory";

export const monorepoDiscoveryProfile = createShapedDiscoveryProfile({
  id: "monorepo",
  priority: 11,
  strongPatterns: [
    /\b(?:monorepo|workspace|pnpm-workspace|turbo(?:repo)?|nx|lerna|yarn\s+workspaces?)\b/i,
    /\b(?:packages\/|apps\/|cross-package|multi-package)\b/i,
  ],
  weakPatterns: [
    /\b(?:package|workspace|shared|internal|build\s+order|dependency\s+graph)\b/i,
  ],
  pathScoreRules: [
    { pattern: /(?:^|\/)pnpm-workspace\.ya?ml$/i, score: 100 },
    { pattern: /(?:^|\/)turbo\.json$/i, score: 95 },
    { pattern: /(?:^|\/)nx\.json$/i, score: 95 },
    { pattern: /(?:^|\/)lerna\.json$/i, score: 90 },
    { pattern: /(?:^|\/)packages\//i, score: 70 },
    { pattern: /(?:^|\/)apps\//i, score: 70 },
    { pattern: /(?:^|\/)package\.json$/i, score: 50 },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)node_modules\//i, score: -100 }],
  globPatterns: [
    "**/pnpm-workspace.yaml",
    "**/pnpm-workspace.yml",
    "**/turbo.json",
    "**/nx.json",
    "**/packages/*/package.json",
    "**/apps/*/package.json",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "pnpm-workspace",
    "turbo pipeline",
    "workspace packages",
    "monorepo build",
  ],
  maxSearchQueries: 1,
  minSeedScore: 40,
  maxSeeds: 4,
  preferredPathsLabel:
    "Preferred monorepo paths (workspace manifests first, then package roots):",
  discoverySystemHint:
    "For monorepo/build asks, start from workspace manifests and package boundaries before deep source walks.",
});
