export const DEFAULT_TOOL_TIMEOUT_MS = 30_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 256_000;
export const DEFAULT_MAX_FILE_BYTES = 128_000;
export const DEFAULT_MAX_LIST_ENTRIES = 200;
export const DEFAULT_MAX_SEARCH_MATCHES = 50;
export const DEFAULT_MAX_SEARCH_FILE_BYTES = 512_000;
export const DEFAULT_MAX_GLOB_RESULTS = 200;
export const DEFAULT_MAX_READ_MANY_FILES = 20;
export const DEFAULT_MAX_BYTES_PER_FILE_MANY = 64_000;
export const DEFAULT_MAX_FILE_METADATA_HASH_BYTES = 128_000;
export const DEFAULT_AUDIT_PREVIEW_CHARS = 500;
export const DEFAULT_GLOB_SKIP_DIRECTORY_NAMES = [
  ".git",
  "node_modules",
] as const;

/**
 * Post-edit diagnostics settle: max wait for host analyzers after mutation.
 * Hosts may return earlier when the diagnostic set is stable.
 */
export const DEFAULT_DIAGNOSTICS_SETTLE_TIMEOUT_MS = 2_000;
/** Poll interval while waiting for diagnostic stability. */
export const DEFAULT_DIAGNOSTICS_SETTLE_POLL_MS = 50;
/**
 * Consecutive identical snapshots required before treating diagnostics as
 * settled (hosts that poll). Single-shot hosts ignore this.
 */
export const DEFAULT_DIAGNOSTICS_SETTLE_STABLE_READS = 2;

/** Absolute schema ceiling for apply_patch.patches length (catalog hard max). */
export const MAX_APPLY_PATCH_PATCHES = 20;

/**
 * Fallback mutation budget when a write grant omits mutationBudget
 * (legacy callers / tests). Matches Decision Policy "standard" profile.
 */
export const DEFAULT_FALLBACK_MUTATION_BUDGET = {
  maxPatchesPerCall: 12,
  maxUniqueFilesPerCall: 8,
  maxPatchPayloadCharacters: 32_000,
  preferredBatchSize: 12,
  requireBatchedExecution: false,
} as const;

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
  "git ls-files",
] as const;
