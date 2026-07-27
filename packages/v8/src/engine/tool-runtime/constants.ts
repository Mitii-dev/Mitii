/**
 * Stable identifiers for Tool Runtime.
 */
export const TOOL_RUNTIME_SCHEMA_VERSION = 1 as const;

/** Read-only tools Decision Policy may grant. */
export const READ_ONLY_TOOL_IDS = [
  "list_directory",
  "read_file",
  "read_many_files",
  "glob_files",
  "file_metadata",
  "search_files",
  "read_diagnostics",
  "read_git_status",
  "run_readonly_command",
  "read_package_scripts",
] as const;

/** Catalogued network tools — granted only when Decision Policy issues hosts/search. */
export const NETWORK_TOOL_IDS = [
  "fetch_url",
  "fetch_docs",
  "web_search",
] as const;

/**
 * Mutation tools Decision Policy may grant by default.
 * `run_command` is executable but opt-in (explicit grant + commandRules).
 */
export const MUTATION_TOOL_IDS = ["apply_patch"] as const;

/** Opt-in mutating process tool (not in default MUTATION_TOOL_IDS). */
export const OPT_IN_MUTATION_TOOL_IDS = ["run_command"] as const;

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
