import { createLogger } from '../../../kernel/telemetry/Logger';

const log = createLogger('PostTaskMemoryWorker');

type MemoryTask = () => Promise<void>;

/**
 * claude-mem style async post-task extraction — queues work off the UI hot path.
 */
export class PostTaskMemoryWorker {
  private chain: Promise<void> = Promise.resolve();
  private pending = 0;

  enqueue(task: MemoryTask): void {
    this.pending++;
    this.chain = this.chain
      .then(async () => {
        await task();
      })
      .catch((error) => {
        log.warn('Post-task memory extraction failed', {
          error: error instanceof Error ? error.message : String(error),
        });
      })
      .finally(() => {
        this.pending = Math.max(0, this.pending - 1);
      });
  }

  getPendingCount(): number {
    return this.pending;
  }
}
