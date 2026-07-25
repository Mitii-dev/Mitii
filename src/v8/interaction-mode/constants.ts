import type {
  AgentMode,
} from "./types";

export const AGENT_MODES = [
  "ask",
  "plan",
  "agent",
] as const satisfies
  readonly AgentMode[];

export const INTERACTION_MODE_DEFAULT =
  "plan" as AgentMode;
