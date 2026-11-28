import type { EndingPosture } from "../../../modules/request-understanding";

/** Thin durable carry so resume can re-drive without host re-supplying the prompt. */
export interface RuntimeSessionCarry {
  runId: string;
  message: string;
  mode: "ask" | "plan" | "agent";
  gateKind?: string;
  /** Last decision route — dialogue continuity for the next start. */
  priorRoute?: string;
  priorTaskBand?: string;
  endingPosture?: EndingPosture;
  updatedAtMs: number;
}

export interface RuntimeSessionStorePort {
  save(carry: RuntimeSessionCarry): void | Promise<void>;
  load(
    runId: string,
  ): RuntimeSessionCarry | undefined | Promise<RuntimeSessionCarry | undefined>;
}
