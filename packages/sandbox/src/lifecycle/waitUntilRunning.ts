import { DEFAULT_SESSION_READY } from '../constants.js';
import { SandboxUnavailableError } from '../contracts/errors.js';
import type { SessionContainer } from './SessionContainer.js';

export type WaitUntilRunningOptions = {
  timeoutMs?: number;
  pollIntervalMs?: number;
};

/**
 * Poll session status until running (or fail with session_unavailable).
 * Raises success rate after create/start races.
 */
export async function waitUntilSessionRunning(
  session: SessionContainer,
  options?: WaitUntilRunningOptions,
): Promise<void> {
  const timeoutMs = options?.timeoutMs ?? DEFAULT_SESSION_READY.timeoutMs;
  const pollIntervalMs =
    options?.pollIntervalMs ?? DEFAULT_SESSION_READY.pollIntervalMs;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = 'missing';

  while (Date.now() < deadline) {
    const info = await session.status();
    lastStatus = info.status;
    if (info.status === 'running') return;
    if (info.status === 'paused') {
      await session.resume();
      continue;
    }
    if (info.status === 'exited' || info.status === 'error') {
      throw new SandboxUnavailableError(
        `session container ${info.status}`,
        'session_not_running',
      );
    }
    await sleep(pollIntervalMs);
  }

  throw new SandboxUnavailableError(
    `session not running within ${timeoutMs}ms (last=${lastStatus})`,
    'session_unavailable',
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
