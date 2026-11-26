/**
 * S11-LOOP — soft rails nudge; hard wall / stall / provider → on_budget hub.
 */

import { evaluateGates } from "../gates";
import type { GateVerdict } from "../gates/kinds";
import type { SoftRailNudge } from "../rails/EvaluateSoftRails";

export function evaluateOnBudgetGate(input: {
  runId: string;
  mode?: "ask" | "plan" | "agent";
  route?: string;
  /** Hard grant/tool-call or wall breach. */
  budgetHardWall?: boolean;
  stalledOrBlocked?: boolean;
  incompleteProgress?: boolean;
  providerUnavailable?: boolean;
  softRails?: readonly SoftRailNudge[];
}): GateVerdict | undefined {
  // Soft nudges never suspend — only structured hard flags hit the hub.
  if (
    !input.budgetHardWall &&
    !input.stalledOrBlocked &&
    !input.incompleteProgress &&
    !input.providerUnavailable
  ) {
    return undefined;
  }

  return evaluateGates("on_budget", {
    runId: input.runId,
    mode: input.mode,
    route: input.route,
    budgetHardWall: input.budgetHardWall,
    stalledOrBlocked: input.stalledOrBlocked,
    incompleteProgress: input.incompleteProgress,
    providerUnavailable: input.providerUnavailable,
  });
}

/**
 * Derive hard-wall from grant tool-call ceiling + soft wall elapsed.
 */
export function resolveBudgetHardWall(input: {
  toolCallCount: number;
  maxToolCalls?: number;
  elapsedMs?: number;
  /** Soft wall; hard wall fires at 2× soft when soft is set. */
  wallTimeSoftMs?: number;
}): boolean {
  if (
    input.maxToolCalls != null &&
    input.maxToolCalls >= 0 &&
    input.toolCallCount >= input.maxToolCalls
  ) {
    return true;
  }
  if (
    input.wallTimeSoftMs != null &&
    input.wallTimeSoftMs > 0 &&
    (input.elapsedMs ?? 0) >= input.wallTimeSoftMs * 2
  ) {
    return true;
  }
  return false;
}
