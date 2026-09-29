import type { RunEvent } from "../contracts";

/**
 * Push-based async iterable for run events.
 * Completes when end() is called; reject() fails the iterator.
 */
export class EventBus {
  private readonly queue: RunEvent[] = [];
  private readonly waiters: Array<{
    resolve: (value: IteratorResult<RunEvent>) => void;
    reject: (reason: unknown) => void;
  }> = [];
  private closed = false;
  private failure: unknown;

  public push(event: RunEvent): void {
    if (this.closed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve({ value: event, done: false });
      return;
    }
    this.queue.push(event);
  }

  public end(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.resolve({ value: undefined, done: true });
    }
  }

  public fail(error: unknown): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.failure = error;
    while (this.waiters.length > 0) {
      const waiter = this.waiters.shift();
      waiter?.reject(error);
    }
  }

  public asIterable(): AsyncIterable<RunEvent> {
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<RunEvent> => ({
        next: (): Promise<IteratorResult<RunEvent>> => {
          if (this.failure !== undefined) {
            return Promise.reject(this.failure);
          }
          if (this.queue.length > 0) {
            const value = this.queue.shift()!;
            return Promise.resolve({ value, done: false });
          }
          if (this.closed) {
            return Promise.resolve({ value: undefined, done: true });
          }
          return new Promise((resolve, reject) => {
            this.waiters.push({ resolve, reject });
          });
        },
      }),
    };
  }
}
