import type { SandboxReasonCode } from '../constants.js';

/** Thrown when a sandbox backend cannot wrap a process request. */
export class SandboxUnavailableError extends Error {
  readonly code: SandboxReasonCode = 'sandbox_unavailable';

  constructor(message: string, code: SandboxReasonCode = 'sandbox_unavailable') {
    super(message);
    this.name = 'SandboxUnavailableError';
    this.code = code;
  }
}

export function formatSandboxFailClosed(message: string): string {
  return `mitii sandbox fail-closed: ${message}`;
}
