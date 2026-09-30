import { createShapedDiscoveryProfile } from "../factory";

export const apiBackendDiscoveryProfile = createShapedDiscoveryProfile({
  id: "api_backend",
  priority: 9,
  strongPatterns: [
    /\b(?:api|rest|graphql|endpoint|route|controller|backend|openapi|swagger)\b/i,
    /\b(?:apollo|express|koa|fastify|nestjs|django|flask|spring)\b/i,
  ],
  weakPatterns: [
    /\b(?:http|url|crud|post|get|put|delete|patch|query|mutation|middleware|server|service|handler|request|response)\b/i,
  ],
  rejectQuery: (query) =>
    /\bpublic\s+api\b/i.test(query) &&
    !/\b(?:route|endpoint|rest|graphql|controller|server|backend)\b/i.test(query),
  pathScoreRules: [
    {
      pattern: /(?:^|\/)(?:routes?|controllers?|endpoints?|api|services?|handlers?)\//i,
      score: 90,
    },
    { pattern: /(?:^|\/)(?:openapi|swagger)\.(?:json|ya?ml)$/i, score: 80 },
    { pattern: /(?:^|\/)schema\.(?:graphql|gql)$/i, score: 80 },
    { pattern: /(?:^|\/)(?:server|app|index)\.(?:ts|js|mjs|cjs)$/i, score: 60 },
    {
      pattern: /(?:^|\/)(?:middleware|interceptor|guard)\.(?:ts|js|mjs|cjs)$/i,
      score: 50,
    },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)node_modules\//i, score: -100 }],
  globPatterns: [
    "**/routes/**/*.ts",
    "**/controllers/**/*.ts",
    "**/api/**/*.ts",
    "**/services/**/*.ts",
    "**/*.graphql",
    "**/openapi.*",
    "**/swagger.*",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "rest endpoint",
    "graphql schema",
    "route handler",
    "controller",
    "middleware",
    "openapi",
  ],
  maxSearchQueries: 1,
  minSeedScore: 30,
  maxSeeds: 5,
  preferredPathsLabel:
    "Preferred API/backend paths (read routes/controllers first, then services/schema):",
  discoverySystemHint:
    "For API/backend asks, source of truth is usually route definitions or controller files, not README or client code.",
});
