import { createShapedDiscoveryProfile } from "../factory";

export const authDiscoveryProfile = createShapedDiscoveryProfile({
  id: "auth",
  priority: 9,
  strongPatterns: [
    /\b(?:auth|authentication|authorization|permission|role|session|token|jwt|oauth|rbac|acl)\b/i,
  ],
  weakPatterns: [
    /\b(?:user|account|credential|password|secure|guard|login|logout)\b/i,
  ],
  pathScoreRules: [
    { pattern: /(?:^|\/)auth\//i, score: 95 },
    { pattern: /(?:^|\/)authorization\//i, score: 95 },
    { pattern: /(?:^|\/)permissions?\//i, score: 90 },
    { pattern: /(?:^|\/)roles?\//i, score: 85 },
    { pattern: /(?:^|\/)sessions?\//i, score: 80 },
    { pattern: /(?:^|\/)middleware\/auth/i, score: 80 },
    { pattern: /(?:^|\/)guards?\//i, score: 75 },
    { pattern: /(?:^|\/)policies?\//i, score: 75 },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)pages?\//i, score: -20 }],
  globPatterns: [
    "**/auth/**/*.ts",
    "**/authorization/**/*.ts",
    "**/permissions/**/*.ts",
    "**/roles/**/*.ts",
    "**/guards/**/*.ts",
    "**/policies/**/*.ts",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "authentication middleware",
    "jwt verify",
    "oauth",
    "authorization guard",
    "permission role",
    "session token",
  ],
  maxSearchQueries: 1,
  minSeedScore: 35,
  maxSeeds: 4,
  preferredPathsLabel:
    "Preferred auth paths (auth/authorization folders first, then middleware/guards):",
  discoverySystemHint:
    "For auth asks, the source of truth is usually in auth/, permissions/, or roles/ directories.",
});
