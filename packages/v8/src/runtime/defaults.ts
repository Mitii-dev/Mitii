/** Host-overridable runtime defaults (knobs, not behaviour branches). */

export const RUNTIME_DEFAULTS = {
  heartbeatEveryTurns: 3,
  heartbeatOnAgentExecute: true,
  maxClarifySuspends: 2,
  toolJournalEnabled: true,
  /** S12-TIME verify budgets (ms / caps). */
  verifyWallMs: 120_000,
  verifyPerCheckTimeoutMs: 30_000,
  verifyMaxChecks: 6,
} as const;

export type RuntimeDefaults = typeof RUNTIME_DEFAULTS;
