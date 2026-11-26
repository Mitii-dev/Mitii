/** Ask mode seal — never write; grant capped to research/none. */
export const askModeSeal = {
  id: "ask_mode_seal",
  neverWrite: true as const,
  maxGrantProfile: "research" as const,
  reasonCodes: ["mode_ask_readonly"] as const,
};
