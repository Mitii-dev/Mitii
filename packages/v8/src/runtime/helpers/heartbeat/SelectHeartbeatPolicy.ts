/**
 * Heartbeat checkpoint policy (§11.10.5 / S11-HEART).
 * Not user-facing — resume continues the loop without a decision.
 */

import { RUNTIME_DEFAULTS } from "../../defaults";

export interface HeartbeatPolicy {
  enabled: boolean;
  /** Save after every N successful loop turns when enabled. */
  everyTurns: number;
  /** Also save after a successful mutation batch. */
  onMutationBatch: boolean;
  reasonCodes: string[];
}

export interface SelectHeartbeatPolicyInput {
  mode?: "ask" | "plan" | "agent";
  route?: string;
  /** Host kill-switch. */
  heartbeat?: boolean;
  /** Override interval-in-turns (default 3). */
  heartbeatEveryTurns?: number;
}

/**
 * Defaults: agent+execute ON; agent+plan ON; ask/clarify/answer/diagnose OFF.
 */
export function selectHeartbeatPolicy(
  input: SelectHeartbeatPolicyInput,
): HeartbeatPolicy {
  if (input.heartbeat === false) {
    return {
      enabled: false,
      everyTurns: input.heartbeatEveryTurns ?? RUNTIME_DEFAULTS.heartbeatEveryTurns,
      onMutationBatch: false,
      reasonCodes: ["heartbeat_disabled_by_host"],
    };
  }

  const mode = input.mode ?? "agent";
  const route = input.route ?? "";
  const everyTurns =
    input.heartbeatEveryTurns ?? RUNTIME_DEFAULTS.heartbeatEveryTurns;

  const agentExecute =
    mode === "agent" &&
    (route === "execute" || route === "agent_execute" || route === "");
  const agentPlan =
    mode === "agent" && (route === "plan" || route === "");
  const planMode = mode === "plan";

  if (agentExecute && RUNTIME_DEFAULTS.heartbeatOnAgentExecute) {
    return {
      enabled: true,
      everyTurns,
      onMutationBatch: true,
      reasonCodes: ["heartbeat_policy_agent_execute"],
    };
  }

  if (agentPlan || planMode) {
    return {
      enabled: true,
      everyTurns,
      onMutationBatch: false,
      reasonCodes: ["heartbeat_policy_plan_discovery"],
    };
  }

  // ask / clarify / answer / short diagnose
  return {
    enabled: false,
    everyTurns,
    onMutationBatch: false,
    reasonCodes: ["heartbeat_policy_off_short_route"],
  };
}
