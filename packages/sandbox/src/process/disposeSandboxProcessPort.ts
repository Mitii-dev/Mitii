import type { ProcessPort } from '@mitii/v8';

import { isSessionSandboxedProcessPort } from './isSessionSandboxedProcessPort.js';

/**
 * Tear down sandbox resources for a process port.
 * Session containers are destroyed; ephemeral wraps are a no-op.
 */
export async function disposeSandboxProcessPort(
  port: ProcessPort | undefined,
): Promise<void> {
  if (!port) return;
  if (isSessionSandboxedProcessPort(port)) {
    await port.destroy();
  }
}
