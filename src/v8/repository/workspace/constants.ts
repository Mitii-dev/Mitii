const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set<string>([
  ".git",
  ".svn",
  ".hg",

  ".mitii",

  "node_modules",
  "bower_components",

  "dist",
  "build",
  "coverage",
  "out",

  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".docusaurus",

  "target",
  "vendor",

  ".gradle",
  ".idea",

  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",

  ".cache",
  ".parcel-cache",
  ".turbo",

  "DerivedData",

  "Pods",

  "bin",
  "obj",
]);

export const WS_CONSTANTS = {
  DEFAULT_IGNORED_DIRECTORY_NAMES,
};
