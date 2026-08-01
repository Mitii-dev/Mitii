export const BOUNDED_WALK_WARNING_CODES = [
  "root_not_found",
  "root_not_directory",
  "read_failed",
  "stat_failed",
  "symbolic_link_skipped",
  "symbolic_link_resolution_failed",
  "symbolic_link_cycle",
  "outside_root",
  "maximum_depth_reached",
  "maximum_files_reached",
  "maximum_directories_reached",
  "ignore_policy_failed",
  "timeout_reached",
  "cancelled",
] as const;

export const BOUNDED_WALKER_CONSTANTS = {
  DEFAULT_MAXIMUM_DEPTH: 20,
  DEFAULT_MAXIMUM_FILES: 50_000,
  DEFAULT_MAXIMUM_DIRECTORIES: 10_000,
  /**
   * The walker checks the deadline between filesystem operations.
   * An already-running provider call cannot always be interrupted.
   */
  DEFAULT_TIMEOUT_MS: 15_000,
  BOUNDED_WALK_WARNING_CODES,
};
