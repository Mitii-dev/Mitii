/** Agent mode default — may select agent_execute when route is execute. */
export const agentModeDefault = {
  id: "agent_mode_default",
  neverWrite: false as const,
  maxGrantProfile: "agent_execute" as const,
  reasonCodes: ["mode_agent_default"] as const,
};
