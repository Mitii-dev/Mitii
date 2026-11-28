import type { ProcessPort } from '@mitii/v8';

import type { SessionSandboxedProcessPort } from '../lifecycle/createSessionSandboxedProcessPort.js';

/** True when the process port is a long-lived session container sandbox. */
export function isSessionSandboxedProcessPort(
  port: ProcessPort,
): port is SessionSandboxedProcessPort {
  if (typeof port !== 'object' || port === null) return false;
  const candidate = port as Partial<SessionSandboxedProcessPort>;
  return (
    candidate.lifecycle === 'session' &&
    typeof candidate.destroy === 'function' &&
    typeof candidate.status === 'function'
  );
}
