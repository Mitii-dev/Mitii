import { createShapedDiscoveryProfile } from "../factory";

export const frontendComponentDiscoveryProfile = createShapedDiscoveryProfile({
  id: "frontend_component",
  priority: 7,
  strongPatterns: [
    /\b(?:component|ui|button|input|modal|dropdown|tooltip|card|layout|style|css|scss|tailwind|styled|react|vue|angular|svelte|frontend)\b/i,
  ],
  weakPatterns: [
    /\b(?:design|theme|color|font|spacing|responsive|animation)\b/i,
  ],
  pathScoreRules: [
    { pattern: /(?:^|\/)components?\//i, score: 90 },
    { pattern: /(?:^|\/)ui\//i, score: 90 },
    { pattern: /\.(?:module\.)?(?:css|scss|less)$/i, score: 60 },
    { pattern: /(?:^|\/)styles?\//i, score: 60 },
    { pattern: /(?:^|\/)theme\//i, score: 60 },
    { pattern: /(?:^|\/)pages?\//i, score: 50 },
    { pattern: /(?:^|\/)layouts?\//i, score: 50 },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)node_modules\//i, score: -100 }],
  includeDefaultSpecDemotion: true,
  globPatterns: [
    "**/components/**/*.tsx",
    "**/components/**/*.ts",
    "**/ui/**/*.tsx",
    "**/ui/**/*.ts",
    "**/*.module.css",
    "**/styles/**/*",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "react component",
    "vue component",
    "modal component",
    "tailwind",
    "styled component",
    "css module",
  ],
  maxSearchQueries: 1,
  minSeedScore: 30,
  maxSeeds: 5,
  preferredPathsLabel:
    "Preferred UI/component paths (component folders first, then style/theme):",
  discoverySystemHint:
    "For frontend asks, look in components/ or ui/ directories, not top-level configs or README.",
});
