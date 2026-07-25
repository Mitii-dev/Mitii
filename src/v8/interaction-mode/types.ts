/**
 * Canonical user interaction boundary.
 *
 * - ask: read-only response or investigation
 * - plan: read-only planning
 * - agent: execution is permitted but never implied
 */
export type AgentMode =
  | "ask"
  | "plan"
  | "agent";
