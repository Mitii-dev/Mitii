/**
 * S10-EVAC — engine suspend *decisions* consult the runtime gates hub.
 * Checkpoint I/O still goes through `saveSuspendedRun` only.
 */

import {
  evaluateGates,
  type GateContext,
  type GateKind,
  type GatePhase,
  type GateVerdict,
} from "../../../runtime/helpers/gates";

export type ConsultRuntimeGateContext = Omit<GateContext, "phase" | "runId"> & {
  runId: string;
  phase?: GatePhase;
};

/**
 * Ask the hub whether this phase should suspend/complete.
 * Returns undefined when no predicate matches (caller continues).
 */
export function consultRuntimeGate(
  phase: GatePhase,
  ctx: ConsultRuntimeGateContext,
): GateVerdict | undefined {
  return evaluateGates(phase, {
    ...ctx,
    phase,
    runId: ctx.runId,
  });
}

/** Hub kind when suspend, else fallback (for legacy emit/finish shapes). */
export function hubSuspendKind(
  verdict: GateVerdict | undefined,
  fallback: GateKind | string,
): string {
  if (verdict?.action === "suspend") return verdict.kind;
  return fallback;
}
