/** Shrink-only intersect with host/user safety fences. */
export const userSafetyIntersectClamp = {
  id: "user_safety_intersect",
  direction: "narrow" as const,
  reasonCodes: ["clamp_user_safety"] as const,
};
