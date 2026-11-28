const DEFAULT_IGNORED_DIRECTORY_NAMES = new Set<string>([
  ".git",
  ".svn",
  ".hg",

  ".mitii",
  ".continue",
  ".cursor",
  ".vs",
  ".idea",

  "logs",

  "node_modules",
  "bower_components",

  "dist",
  "build",
  "coverage",
  "out",

  // Test / report artifacts (often huge; crowd out source in file maps)
  "allure-results",
  "allure-report",
  "test-results",
  "playwright-report",
  "mochawesome-report",

  ".next",
  ".nuxt",
  ".output",
  ".svelte-kit",
  ".docusaurus",

  "target",
  "vendor",

  ".gradle",
  ".mvn",

  "__pycache__",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  ".venv",
  "venv",
  "site-packages",

  ".cache",
  ".parcel-cache",
  ".turbo",

  "DerivedData",

  "Pods",

  "bin",
  "obj",
]);

const DEFAULT_SECURITY_DIRECTORY_NAMES = new Set<string>([
  ".aws",
  ".gcp",
  ".azure",
  ".kube",
  ".docker",
  ".ssh",
  ".gnupg",
  ".gpg",
  "secrets",
  ".secrets",
  "certs",
  "certificates",
  "keys",
]);

const DEFAULT_IGNORED_FILE_NAMES = new Set<string>([
  ".pnp.cjs",
  ".pnp.loader.mjs",
  ".DS_Store",
  "Thumbs.db",
  "go.sum",
]);

const DEFAULT_SECURITY_FILE_NAMES = new Set<string>([
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "auth.json",
  "docker-compose.override.yml",
  "docker-compose.override.yaml",
]);

const DEFAULT_SECURITY_FILE_GLOBS = [
  ".env",
  ".env*",
  "*.env",
  "*.env.*",
  "*.key",
  "*.pem",
  "*.p12",
  "*.pfx",
  "*.crt",
  "*.cer",
  "*.jks",
  "*.keystore",
  "*.truststore",
  "*.ppk",
  "*.gpg",
  "*.secret",
  "*.secrets",
  "*.token",
] as const;

const DEFAULT_IGNORED_EXTENSIONS = new Set<string>([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".ico",
  ".webp",
  ".mp4",
  ".mov",
  ".avi",
  ".mkv",
  ".webm",
  ".mp3",
  ".wav",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".rar",
  ".7z",
  ".dmg",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".lib",
  ".obj",
  ".wasm",
  ".onnx",
  ".woff",
  ".woff2",
  ".eot",
  ".ttf",
  ".otf",
  ".lock",
  ".bin",
  ".pdb",
  ".parquet",
  ".csv",
  ".jsonl",
  ".map",
]);

const DEFAULT_IGNORE_FILE_NAMES = [
  ".gitignore",
  ".mitiiignore",
  ".thunderignore",
] as const;

export const WS_CONSTANTS = {
  DEFAULT_IGNORED_DIRECTORY_NAMES,
  DEFAULT_SECURITY_DIRECTORY_NAMES,
  DEFAULT_IGNORED_FILE_NAMES,
  DEFAULT_SECURITY_FILE_NAMES,
  DEFAULT_SECURITY_FILE_GLOBS,
  DEFAULT_IGNORED_EXTENSIONS,
  DEFAULT_IGNORE_FILE_NAMES,
};
