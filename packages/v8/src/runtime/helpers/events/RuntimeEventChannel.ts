import type { RunEvent } from "../../../engine/v8-engine/contracts";

/**
 * Pushable async event stream — consumers can read while the pump still runs.
 */
export class RuntimeEventChannel {
  private readonly queue: RunEvent[] = [];
  private readonly waiters: Array<() => void> = [];
  private closed = false;
  private failed: Error | undefined;
  private readIndex = 0;

  push(event: RunEvent): void {
    if (this.closed) return;
    this.queue.push(event);
    this.wake();
  }

  end(): void {
    if (this.closed) return;
    this.closed = true;
    this.wake();
  }

  fail(error: Error): void {
    if (this.closed) return;
    this.failed = error;
    this.closed = true;
    this.wake();
  }

  async *events(): AsyncGenerator<RunEvent, void, undefined> {
    while (true) {
      while (this.readIndex < this.queue.length) {
        yield this.queue[this.readIndex++]!;
      }
      if (this.failed) throw this.failed;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
      });
    }
  }

  private wake(): void {
    const pending = this.waiters.splice(0, this.waiters.length);
    for (const resolve of pending) resolve();
  }
}

export interface RuntimeEventSink {
  push(event: RunEvent): void;
}
