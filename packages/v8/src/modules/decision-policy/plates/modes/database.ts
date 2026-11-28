/** Database mode plate stub (S2C-MODE-DB) — room for readonly DB grant profile. */
export const databaseModeSeal = {
  id: "database_mode_seal",
  neverWrite: true as const,
  maxGrantProfile: "research" as const,
  reasonCodes: ["mode_database_readonly"] as const,
};
