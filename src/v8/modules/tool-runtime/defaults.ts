export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 256_000;
export const DEFAULT_MAX_FILE_BYTES = 128_000;
export const DEFAULT_MAX_LIST_ENTRIES = 200;
export const DEFAULT_MAX_SEARCH_MATCHES = 50;
export const DEFAULT_MAX_SEARCH_FILE_BYTES = 512_000;
export const DEFAULT_AUDIT_PREVIEW_CHARS = 500;

export const DEFAULT_ALLOWED_COMMAND_ENV = [
  "PATH",
  "HOME",
  "USER",
  "LANG",
  "LC_ALL",
  "TERM",
  "TMPDIR",
  "TMP",
  "TEMP",
] as const;

export const DEFAULT_READONLY_COMMAND_PREFIXES = [
  "git status",
  "git diff",
  "git log",
  "git show",
  "git blame",
] as const;
