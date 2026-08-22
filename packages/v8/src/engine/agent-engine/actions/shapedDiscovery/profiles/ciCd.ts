import { createShapedDiscoveryProfile } from "../factory";

export const ciCdDiscoveryProfile = createShapedDiscoveryProfile({
  id: "ci_cd",
  priority: 10,
  strongPatterns: [
    /\b(?:ci|cd|pipeline|deploy|docker|kubernetes|k8s|github\s+actions|gitlab\s+ci|jenkins|circleci|travis|terraform|ansible|infrastructure|aws|gcp|azure)\b/i,
  ],
  weakPatterns: [
    /\b(?:build|release|stage|prod|environment|container|image)\b/i,
  ],
  pathScoreRules: [
    { pattern: /(?:^|\/)\.github\/workflows\//i, score: 100 },
    { pattern: /(?:^|\/)\.gitlab-ci\.yml$/i, score: 100 },
    { pattern: /(?:^|\/)jenkinsfile$/i, score: 90 },
    { pattern: /(?:^|\/)dockerfile$/i, score: 80 },
    { pattern: /(?:^|\/)docker-compose\.(?:yml|yaml)$/i, score: 80 },
    { pattern: /(?:^|\/)k8s\//i, score: 80 },
    { pattern: /(?:^|\/)deploy(?:ment)?\//i, score: 70 },
    { pattern: /(?:^|\/)infra(?:structure)?\//i, score: 70 },
    { pattern: /(?:^|\/)terraform\//i, score: 70 },
  ],
  pathDemotionRules: [{ pattern: /(?:^|\/)docs?\//i, score: -40 }],
  globPatterns: [
    "**/.github/workflows/*.yml",
    "**/.github/workflows/*.yaml",
    "**/.gitlab-ci.yml",
    "**/Jenkinsfile",
    "**/Dockerfile",
    "**/docker-compose.yml",
    "**/k8s/**/*.yaml",
    "**/terraform/**/*.tf",
  ],
  maxGlobPatterns: 3,
  searchQueries: [
    "github actions workflow",
    "dockerfile",
    "kubernetes deployment",
    "ci pipeline",
    "terraform",
    "deploy config",
  ],
  maxSearchQueries: 1,
  minSeedScore: 40,
  maxSeeds: 3,
  preferredPathsLabel:
    "Preferred CI/CD paths (workflows, pipelines, Dockerfiles first):",
  discoverySystemHint:
    "For CI/CD and infrastructure asks, workflow definitions and container configs are authoritative.",
});
