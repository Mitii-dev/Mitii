/** Shrink-only clamp for injection / untrusted prompt overlays. */
export const injectionClamp = {
  id: "injection_clamp",
  direction: "narrow" as const,
  reasonCodes: ["clamp_injection"] as const,
};
