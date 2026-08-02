const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set<string>([
  ".git",
  ".svn",
  ".hg",

  ".mitii",

  "logs",

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

const DEFAULT_IGNORED_FILE_NAMES = new Set<string>([
  ".pnp.cjs",
  ".pnp.loader.mjs",
]);

export const WS_CONSTANTS = {
  DEFAULT_IGNORED_DIRECTORY_NAMES,
  DEFAULT_IGNORED_FILE_NAMES,
};
