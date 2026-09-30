export type PendingRequest<T = unknown> = {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

/**
 * In-flight JSON-RPC request registry with per-request timeout.
 * Cancel removes an entry and leaves the shared server running (OpenClaw).
 */
export class PendingRequestRegistry {
  private readonly pending = new Map<number, PendingRequest>();

  public add<T>(
    id: number,
    timeoutMs: number,
    timeoutError: () => Error,
  ): Promise<T> {
    if (this.pending.has(id)) {
      return Promise.reject(new Error(`LSP request id collision: ${id}`));
    }
    return new Promise<T>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(id);
        reject(timeoutError());
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timeoutId,
      });
    });
  }

  public take(id: number): PendingRequest | undefined {
    const entry = this.pending.get(id);
    if (!entry) return undefined;
    this.pending.delete(id);
    clearTimeout(entry.timeoutId);
    return entry;
  }

  public rejectAll(error: Error): void {
    for (const [id, entry] of this.pending) {
      clearTimeout(entry.timeoutId);
      entry.reject(error);
      this.pending.delete(id);
    }
  }

  public get size(): number {
    return this.pending.size;
  }
}
