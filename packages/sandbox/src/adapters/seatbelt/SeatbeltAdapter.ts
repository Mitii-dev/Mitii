import { platform } from 'node:os';

import type { ProcessExecRequest } from '@mitii/v8';

import type { SandboxBackend, SandboxPolicy } from '../../contracts/policy.js';
import { scrubSandboxedEnv } from '../../helpers/envScrub.js';
import { buildSeatbeltProfile } from './buildSeatbeltProfile.js';

export const MACOS_SANDBOX_EXEC = '/usr/bin/sandbox-exec';

export function resolveSeatbeltBackend(): SandboxBackend {
  const available = platform() === 'darwin';
  return {
    id: 'seatbelt',
    available,
    reason: available ? undefined : 'not macOS',
    wrap(request, policy) {
      return wrapWithSeatbelt(request, policy);
    },
  };
}

export function wrapWithSeatbelt(
  request: ProcessExecRequest,
  policy: SandboxPolicy,
): ProcessExecRequest {
  const scrubbed = scrubSandboxedEnv(request, policy);
  const [command, ...args] = scrubbed.argv;
  if (!command) return scrubbed;
  const profile = buildSeatbeltProfile(policy);
  return {
    ...scrubbed,
    argv: [MACOS_SANDBOX_EXEC, '-p', profile, command, ...args],
  };
}
