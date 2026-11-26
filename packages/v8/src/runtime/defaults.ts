/** Host-overridable runtime defaults (knobs, not behaviour branches). */

export const RUNTIME_DEFAULTS = {
  heartbeatEveryTurns: 3,
  heartbeatOnAgentExecute: true,
  maxClarifySuspends: 2,
  toolJournalEnabled: true,
} as const;

export type RuntimeDefaults = typeof RUNTIME_DEFAULTS;
