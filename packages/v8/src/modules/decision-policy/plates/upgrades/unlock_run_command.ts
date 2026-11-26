/** Widen: unlock process_write / run_command under audit. */
export const unlockRunCommandUpgrade = {
  id: "upgrade_unlock_run_command",
  direction: "widen" as const,
  reasonCodes: ["upgrade_unlock_run_command"] as const,
};
