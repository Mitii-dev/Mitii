import {
  DEFAULT_AGENT_LOG_VERBOSITY,
  type AgentLogVerbosity,
} from "../constants";

export type { AgentLogVerbosity };

const RANK: Record<AgentLogVerbosity, number> = {
  minimal: 0,
  standard: 1,
  verbose: 2,
};

/**
 * True when `verbosity` is at least as detailed as `min`. Used to gate
 * additive diagnostic fields/events so hosts can turn log volume down
 * without losing the baseline event set.
 */
export function logVerbosityAtLeast(
  verbosity: AgentLogVerbosity | undefined,
  min: AgentLogVerbosity,
): boolean {
  return RANK[verbosity ?? DEFAULT_AGENT_LOG_VERBOSITY] >= RANK[min];
}
