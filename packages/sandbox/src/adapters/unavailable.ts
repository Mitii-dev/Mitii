import type { SandboxBackend } from '../contracts/policy.js';
import { failWrap } from '../helpers/failWrap.js';

export function unavailableBackend(reason: string): SandboxBackend {
  return {
    id: 'unavailable',
    available: false,
    reason,
    wrap: failWrap,
  };
}
