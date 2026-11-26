/** Widen: unlock network hosts / web_search under audit. */
export const unlockNetworkUpgrade = {
  id: "upgrade_unlock_network",
  direction: "widen" as const,
  reasonCodes: ["upgrade_unlock_network"] as const,
};
