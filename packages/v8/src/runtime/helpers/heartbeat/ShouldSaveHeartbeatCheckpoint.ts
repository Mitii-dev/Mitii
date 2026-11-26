/**
 * When to persist a heartbeat checkpoint (S11-HEART).
 */

import type { HeartbeatPolicy } from "./SelectHeartbeatPolicy";

export interface ShouldSaveHeartbeatCheckpointInput {
  policy: HeartbeatPolicy;
  /** Completed turn/loop iterations this run so far. */
  turnCount: number;
  /** Turns since last heartbeat checkpoint (0 = never). */
  turnsSinceLastHeartbeat: number;
  /** A mutating tool settled successfully this turn. */
  mutationBatchSucceeded?: boolean;
  /** Host disabled at runtime. */
  heartbeatEnabled?: boolean;
}

export interface ShouldSaveHeartbeatCheckpointResult {
  save: boolean;
  reasonCodes: string[];
}

export function shouldSaveHeartbeatCheckpoint(
  input: ShouldSaveHeartbeatCheckpointInput,
): ShouldSaveHeartbeatCheckpointResult {
  if (input.heartbeatEnabled === false || !input.policy.enabled) {
    return {
      save: false,
      reasonCodes: ["heartbeat_skip_disabled"],
    };
  }

  const every = Math.max(1, input.policy.everyTurns);
  const dueByTurns = input.turnsSinceLastHeartbeat >= every;

  if (input.policy.onMutationBatch && input.mutationBatchSucceeded) {
    return {
      save: true,
      reasonCodes: ["heartbeat_due_mutation_batch"],
    };
  }

  if (dueByTurns && input.turnCount > 0) {
    return {
      save: true,
      reasonCodes: ["heartbeat_due_every_turns"],
    };
  }

  return {
    save: false,
    reasonCodes: ["heartbeat_not_due"],
  };
}
