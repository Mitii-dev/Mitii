import type { ProcessExecRequest } from '@mitii/v8';

import {
  SANDBOX_SECRET_ENV_PATTERNS,
  SANDBOX_STRIP_ENV_KEYS,
} from '../constants.js';
import type { SandboxPolicy } from '../contracts/policy.js';
import { matchesAnyEnvPattern } from './envPatterns.js';

/**
 * Strip loader-hijack keys and (by profile) secret-like env names.
 * Does not widen the environment.
 */
export function scrubSandboxedEnv(
  request: ProcessExecRequest,
  policy: SandboxPolicy,
): ProcessExecRequest {
  const scrub = policy.scrubEnv !== false;
  if (!scrub || !request.env) {
    return request;
  }
  const next: Record<string, string> = { ...request.env };
  for (const key of SANDBOX_STRIP_ENV_KEYS) {
    delete next[key];
  }

  const profile = policy.isolationProfile ?? 'balanced';
  if (profile !== 'permissive') {
    const patterns = [
      ...SANDBOX_SECRET_ENV_PATTERNS,
      ...(policy.extraEnvDenyPatterns ?? []),
    ];
    for (const key of Object.keys(next)) {
      if (matchesAnyEnvPattern(key, patterns)) {
        delete next[key];
      }
    }
  }

  return { ...request, env: next };
}
