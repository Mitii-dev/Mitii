export const CRITIC_MODES = ["off", "shadow", "enforce"] as const;
export type CriticMode = (typeof CRITIC_MODES)[number];
