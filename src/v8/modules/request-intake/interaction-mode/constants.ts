export const AGENT_MODES = [
  "ask",
  "plan",
  "agent",
] as const;

export type AgentMode = (typeof AGENT_MODES)[number];

export const INTERACTION_MODE_DEFAULT: AgentMode = "plan";
