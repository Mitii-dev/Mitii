import { createShapedDiscoveryProfile } from "../factory";

export const databaseDiscoveryProfile = createShapedDiscoveryProfile({
  id: "database",
  priority: 8,
  strongPatterns: [
    /\b(?:database|db|schema|migration|model|entity|table|column|sql|orm|sequelize|typeorm|prisma|mongoose|drizzle)\b/i,
  ],
  weakPatterns: [/\b(?:data|store|record|relation|join|index|query)\b/i],
  pathScoreRules: [
    { pattern: /(?:^|\/)migrations?\//i, score: 90 },
    { pattern: /(?:^|\/)models?\//i, score: 90 },
    { pattern: /(?:^|\/)entities?\//i, score: 90 },
    { pattern: /(?:^|\/)schema\.(?:prisma|sql|ts|js)$/i, score: 85 },
    { pattern: /(?:^|\/)seed(?:ers?)?\//i, score: 70 },
    { pattern: /(?:^|\/)repositories?\//i, score: 70 },
    { pattern: /(?:^|\/)db\//i, score: 60 },
    { pattern: /(?:^|\/)prisma\//i, score: 65 },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)docs?\//i, score: -50 }],
  includeDefaultSpecDemotion: true,
  globPatterns: [
    "**/migrations/**/*",
    "**/models/**/*.ts",
    "**/entities/**/*.ts",
    "**/*.prisma",
    "**/schema.sql",
    "**/repositories/**/*.ts",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "database schema",
    "migration",
    "prisma schema",
    "typeorm entity",
    "sequelize model",
    "create table",
  ],
  maxSearchQueries: 1,
  minSeedScore: 35,
  maxSeeds: 4,
  preferredPathsLabel:
    "Preferred database paths (migrations and models first, then repositories):",
  discoverySystemHint:
    "For database/schema asks, migrations and entity definitions are the most authoritative.",
});
