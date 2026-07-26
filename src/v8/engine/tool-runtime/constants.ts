/**
 * Stable identifiers for Tool Runtime.
 */
export const TOOL_RUNTIME_SCHEMA_VERSION = 1 as const;

/** Phase 4 read-only vertical-slice tools. */
export const READ_ONLY_TOOL_IDS = [
  "list_directory",
  "read_file",
  "search_files",
  "read_diagnostics",
  "read_git_status",
  "run_readonly_command",
] as const;

/** Catalogued but not granted by Decision Policy in Phase 4. */
export const NETWORK_TOOL_IDS = ["fetch_url"] as const;

/** Phase 8 mutation tools. `run_command` remains catalogued but unavailable. */
export const MUTATION_TOOL_IDS = ["apply_patch", "run_command"] as const;

export const TOOL_BACKENDS = ["local", "host", "mcp"] as const;

export const TOOL_RESULT_STATUSES = [
  "succeeded",
  "rejected",
  "failed",
  "cancelled",
  "timed_out",
] as const;

export const TOOL_REASON_CODES = [
  "tool_not_allowed",
  "tool_not_registered",
  "tool_unavailable",
  "invalid_arguments",
  "effect_not_granted",
  "path_out_of_scope",
  "path_escape",
  "symlink_escape",
  "command_not_allowed",
  "command_injection",
  "network_not_allowed",
  "limit_exceeded",
  "output_truncated",
  "timeout",
  "cancelled",
  "approval_required",
  "approval_mismatch",
  "dirty_overlap",
  "patch_conflict",
  "checkpoint_missing",
  "rollback_failed",
  "pinned_state_missing",
  "execution_failed",
] as const;

export const TOOL_RUNTIME_ERROR_CODES = [
  "invalid_input",
  "misconfigured_ports",
] as const;

export const TOOL_EFFECTS = [
  "workspace_read",
  "workspace_write",
  "process_execute",
  "network_access",
  "git_write",
  "external_write",
  "secret_use",
] as const;

export const SHELL_METACHARACTERS = [
  "|",
  "&",
  ";",
  ">",
  "<",
  "`",
  "$",
  "(",
  ")",
  "{",
  "}",
  "[",
  "]",
  "*",
  "?",
  "~",
  "\n",
  "\r",
] as const;
