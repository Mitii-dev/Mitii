import type {
  ToolOutputSpillPort,
  ToolOutputSpillStoreRequest,
  ToolOutputSpillStoreResult,
} from "../contracts/ports/ToolOutputSpillPort";

/**
 * Process-local spill store for tests and hosts that lack durable storage.
 */
export class InMemoryToolOutputSpillAdapter implements ToolOutputSpillPort {
  private readonly entries = new Map<string, string>();
  private seq = 0;

  public async store(
    request: ToolOutputSpillStoreRequest,
  ): Promise<ToolOutputSpillStoreResult> {
    this.seq += 1;
    const spillId = `mem_spill_${this.seq}_${request.callId}`;
    this.entries.set(spillId, request.payload);
    return { spillId };
  }

  public async read(spillId: string): Promise<string | undefined> {
    return this.entries.get(spillId);
  }

  public size(): number {
    return this.entries.size;
  }

  public clear(): void {
    this.entries.clear();
  }
}
