/**
 * Aider-inspired root important-file basename pins (formula inject, not drop-in).
 * Matched against the final path segment (case-insensitive).
 */
export const REPO_MAP_IMPORTANT_FILE_BASENAMES: ReadonlySet<string> = new Set(
  [
    // docs / policy
    "readme",
    "readme.md",
    "readme.txt",
    "readme.rst",
    "contributing",
    "contributing.md",
    "license",
    "license.md",
    "license.txt",
    "changelog",
    "changelog.md",
    "agents.md",
    "codeowners",
    // package manifests
    "package.json",
    "package-lock.json",
    "pnpm-lock.yaml",
    "yarn.lock",
    "cargo.toml",
    "go.mod",
    "pyproject.toml",
    "requirements.txt",
    "pipfile",
    "gemfile",
    "composer.json",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    // project config
    "tsconfig.json",
    "jsconfig.json",
    "turbo.json",
    "nx.json",
    "lerna.json",
    "dockerfile",
    "docker-compose.yml",
    "docker-compose.yaml",
    ".gitignore",
    ".editorconfig",
  ].map((name) => name.toLowerCase()),
);

export function isImportantRepoMapFile(
  relativePath: string,
): boolean {
  const normalized = relativePath
    .trim()
    .replace(/\\/g, "/")
    .toLowerCase();
  const basename =
    normalized.split("/").at(-1) ?? "";
  if (!basename) {
    return false;
  }
  return REPO_MAP_IMPORTANT_FILE_BASENAMES.has(basename);
}
