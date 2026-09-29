import { createShapedDiscoveryProfile } from "../factory";

export const securityDiscoveryProfile = createShapedDiscoveryProfile({
  id: "security",
  priority: 12,
  strongPatterns: [
    /\b(?:xss|csrf|ssrf|sqli|sql\s+injection|rce|path\s+traversal|authz|authn)\b/i,
    /\b(?:vulnerabilit(?:y|ies)|cve|security\s+fix|harden(?:ing)?|sanitize|escape)\b/i,
    /\b(?:secret|credential|api\s+key|token\s+leak|unsafe)\b/i,
  ],
  weakPatterns: [
    /\b(?:security|secure|permission|access\s+control|injection|sanitize)\b/i,
  ],
  rejectQuery: (query) =>
    /\b(?:auth|oauth|jwt|login|session)\b/i.test(query) &&
    !/\b(?:vulnerabilit|xss|csrf|ssrf|injection|cve|harden|sanitize|secret)\b/i.test(
      query,
    ),
  pathScoreRules: [
    { pattern: /(?:^|\/)security\//i, score: 95 },
    { pattern: /(?:^|\/)middleware\//i, score: 70 },
    { pattern: /(?:^|\/)(?:auth|guards?|policies?)\//i, score: 65 },
    { pattern: /\.(?:ts|js|tsx|jsx|py|go|java)$/i, score: 20 },
  ],
  pathDemotionRules: [
    { pattern: /(?:^|\/)docs?\//i, score: -50 },
    { pattern: /(?:^|\/)node_modules\//i, score: -100 },
  ],
  globPatterns: [
    "**/security/**/*.{ts,js,tsx,jsx}",
    "**/middleware/**/*.{ts,js}",
    "**/guards/**/*.{ts,js}",
    "**/*sanitiz*.{ts,js}",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "sanitize input",
    "csrf protection",
    "xss escape",
    "path traversal",
    "secret handling",
  ],
  maxSearchQueries: 1,
  minSeedScore: 30,
  maxSeeds: 4,
  preferredPathsLabel:
    "Preferred security paths (guards/middleware/sanitizers first):",
  discoverySystemHint:
    "For security fixes, prioritize input validation, authz checks, and sanitizers over README or client UI.",
});
