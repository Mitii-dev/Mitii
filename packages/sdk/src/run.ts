import {
  agentRunResultSchema,
  runEventSchema,
} from '@mitii/v8';
import type { AgentRunHandle, AgentRunResult, RunEvent } from '@mitii/v8';

export type { AgentRunResult, RunEvent };

export function isRunEvent(value: unknown): value is RunEvent {
  return runEventSchema.safeParse(value).success;
}

export function isTerminalRunEvent(
  event: RunEvent,
): event is Extract<RunEvent, { type: 'terminal' }> {
  return event.type === 'terminal';
}

export function isSuspendedRunEvent(
  event: RunEvent,
): event is Extract<RunEvent, { type: 'suspended' }> {
  return event.type === 'suspended';
}

/**
 * Opaque SDK run handle wrapping V8 AgentRunHandle.
 */
export class MitiiRun {
  readonly runId: string;
  readonly events: AsyncIterable<RunEvent>;
  readonly result: Promise<AgentRunResult>;

  private readonly cancelImpl: (reason?: string) => void;

  constructor(handle: AgentRunHandle) {
    this.runId = handle.runId;
    this.events = handle.events;
    this.result = handle.result.then((result) =>
      agentRunResultSchema.parse(result),
    );
    this.cancelImpl = (reason?: string) => handle.cancel(reason);
  }

  cancel(reason?: string): void {
    this.cancelImpl(reason);
  }
}
