import type { ProcessExecRequest } from '@mitii/v8';

import { SandboxUnavailableError } from '../contracts/errors.js';
import type { SandboxPolicy } from '../contracts/policy.js';

export function failWrap(
  _request: ProcessExecRequest,
  _policy: SandboxPolicy,
): ProcessExecRequest {
  throw new SandboxUnavailableError(
    'Sandbox backend cannot wrap process',
    'wrap_failed',
  );
}
