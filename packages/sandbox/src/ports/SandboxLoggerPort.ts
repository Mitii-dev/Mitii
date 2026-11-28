/**
 * Optional sandbox logger. Hosts may inject; omit for silent operation.
 * Never log env values, secrets, or full command argv with credentials.
 */
export interface SandboxLoggerPort {
  event(event: {
    module: 'sandbox';
    stage: string;
    level?: 'debug' | 'info' | 'warn' | 'error';
    durationMs?: number;
    reasonCodes?: readonly string[];
    details?: Record<string, unknown>;
  }): void;
}

export const noopSandboxLogger: SandboxLoggerPort = {
  event() {
    /* no-op */
  },
};
