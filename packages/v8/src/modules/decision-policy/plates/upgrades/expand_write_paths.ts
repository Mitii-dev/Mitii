/** Widen: expand writePaths + audit trail. */
export const expandWritePathsUpgrade = {
  id: "upgrade_expand_write_paths",
  direction: "widen" as const,
  reasonCodes: ["upgrade_expand_write_paths"] as const,
};
