/** Widen: promote diagnose → execute only via this plate. */
export const promoteDiagnoseToExecuteUpgrade = {
  id: "upgrade_diagnose_to_execute",
  direction: "widen" as const,
  reasonCodes: ["upgrade_diagnose_to_execute"] as const,
};
