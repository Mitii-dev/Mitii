import type { ManifestMatch, ProjectEcosystemId } from "./types";

export const ECOSYSTEM_IDS = {
  NODE: "node",
  RUST: "rust",
  GO: "go",
  PYTHON: "python",
  JAVA: "java",
  DOTNET: "dotnet",
  PHP: "php",
  RUBY: "ruby",
  UNKNOWN: "unknown",
} as const satisfies Record<string, ProjectEcosystemId>;

export const EXACT_MANIFESTS: Readonly<Record<string, ManifestMatch>> = {
  "package.json": {
    kind: "package_json",
    priority: 10,
    secondary: false,
  },

  "cargo.toml": {
    kind: "cargo",
    priority: 10,
    secondary: false,
  },

  "go.mod": {
    kind: "go_module",
    priority: 10,
    secondary: false,
  },

  "pyproject.toml": {
    kind: "python_pyproject",
    priority: 10,
    secondary: false,
  },

  "setup.py": {
    kind: "python_setup",
    priority: 20,
    secondary: false,
  },

  "setup.cfg": {
    kind: "python_setup",
    priority: 20,
    secondary: false,
  },

  "requirements.txt": {
    kind: "python_requirements",
    priority: 50,
    secondary: true,
  },

  "pom.xml": {
    kind: "maven",
    priority: 10,
    secondary: false,
  },

  "build.gradle": {
    kind: "gradle",
    priority: 10,
    secondary: false,
  },

  "build.gradle.kts": {
    kind: "gradle",
    priority: 10,
    secondary: false,
  },

  "composer.json": {
    kind: "composer",
    priority: 10,
    secondary: false,
  },

  gemfile: {
    kind: "ruby",
    priority: 10,
    secondary: false,
  },
};

export const PROJECT_CATALOG_CONSTANTS = {
  ECOSYSTEM_IDS,
  EXACT_MANIFESTS,
} as const;
