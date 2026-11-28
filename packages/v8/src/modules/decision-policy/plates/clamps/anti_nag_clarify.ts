/** Suppress clarify when anti-nag applies — continue with stated assumptions. */
export const antiNagClarifyClamp = {
  id: "anti_nag_suppress_clarify",
  direction: "narrow" as const,
  reasonCodes: ["clamp_anti_nag_clarify"] as const,
};
