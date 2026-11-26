import type { GateVerdict } from "./kinds";
import type { RuntimeGateCheckpoint } from "./types";

/** Pure: verdict + ids → checkpoint record (no I/O). */
export function buildCheckpoint(input: {
  runId: string;
  requestId: string;
  verdict: Extract<GateVerdict, { action: "suspend" }>;
  nowMs?: number;
}): RuntimeGateCheckpoint {
  return {
    runId: input.runId,
    requestId: input.requestId,
    suspensionKind: input.verdict.kind,
    payload: input.verdict.payload ?? {},
    reasonCodes: input.verdict.reasonCodes ?? [],
    suspendedAtMs: input.nowMs ?? Date.now(),
  };
}
