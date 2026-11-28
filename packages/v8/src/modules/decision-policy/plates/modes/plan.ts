/** Plan mode seal — never write; route biased to plan + research. */
export const planModeSeal = {
  id: "plan_mode_seal",
  neverWrite: true as const,
  maxGrantProfile: "research" as const,
  reasonCodes: ["mode_plan_readonly"] as const,
};
