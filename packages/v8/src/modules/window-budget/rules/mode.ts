import type { WindowBudgetPolicyOverrides } from "../types";

/**
 * Agent interaction modes that can reshape how a context window is spent.
 * Kept local to window-budget (no import from request-intake) so the module
 * stays free of engine/intake dependencies.
 */
export const WINDOW_BUDGET_MODES = ["ask", "plan", "agent"] as const;

export type WindowBudgetMode = (typeof WINDOW_BUDGET_MODES)[number];

export const DEFAULT_WINDOW_BUDGET_MODE: WindowBudgetMode = "ask";

/**
 * Static mode overlays merged after window bands and before host lab overrides.
 * When a mode is active these values replace the matching policy knobs.
 */
export interface WindowBudgetModeOverlay {
  /** Partial policy deltas applied for this mode. */
  policy: WindowBudgetPolicyOverrides;
}

/**
 * Mode retention / share tables. Ask leans conversation; plan leans plan text;
 * agent keeps balanced defaults (mutation still owned by effort overlay).
 */
export const WINDOW_BUDGET_MODE_OVERLAY: Record<
  WindowBudgetMode,
  WindowBudgetModeOverlay
> = {
  ask: {
    policy: {
      conversationShare: 0.48,
      repositoryShare: 0.22,
      planShare: 0.04,
      skillsShare: 0.04,
      // Keep more prior turns for follow-up Q&A.
      carryMaxMessagesMin: 64,
      carryMaxMessagesRatio: 0.004,
    },
  },
  plan: {
    policy: {
      conversationShare: 0.34,
      repositoryShare: 0.28,
      planShare: 0.12,
      skillsShare: 0.05,
      planTokensCap: 48_000,
    },
  },
  agent: {
    policy: {
      // Same history retention as ask so ask → agent handoffs do not drop turns.
      conversationShare: 0.4,
      repositoryShare: 0.28,
      planShare: 0.06,
      skillsShare: 0.04,
      carryMaxMessagesMin: 64,
      carryMaxMessagesRatio: 0.004,
    },
  },
};

export function resolveWindowBudgetMode(
  value?: string,
): WindowBudgetMode | undefined {
  if (
    value !== undefined &&
    (WINDOW_BUDGET_MODES as readonly string[]).includes(value)
  ) {
    return value as WindowBudgetMode;
  }
  return undefined;
}

export function windowBudgetModeOverlay(
  mode: WindowBudgetMode,
): WindowBudgetModeOverlay {
  return WINDOW_BUDGET_MODE_OVERLAY[mode];
}
