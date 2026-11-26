/** Thin durable carry so resume can re-drive without host re-supplying the prompt. */
export interface RuntimeSessionCarry {
  runId: string;
  message: string;
  mode: "ask" | "plan" | "agent";
  gateKind?: string;
  updatedAtMs: number;
}

export interface RuntimeSessionStorePort {
  save(carry: RuntimeSessionCarry): void | Promise<void>;
  load(
    runId: string,
  ): RuntimeSessionCarry | undefined | Promise<RuntimeSessionCarry | undefined>;
}
