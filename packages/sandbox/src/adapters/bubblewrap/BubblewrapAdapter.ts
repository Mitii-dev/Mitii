import { existsSync, statSync } from 'node:fs';

import type { ProcessExecRequest } from '@mitii/v8';

import type { SandboxBackend, SandboxPolicy } from '../../contracts/policy.js';
import { commandExists } from '../../helpers/commandExists.js';
import { scrubSandboxedEnv } from '../../helpers/envScrub.js';
import { LINUX_PLATFORM_READ_PATHS } from '../../helpers/platformReads.js';

export function resolveBubblewrapBackend(): SandboxBackend {
  const available = commandExists('bwrap');
  return {
    id: 'bubblewrap',
    available,
    reason: available ? undefined : 'bwrap not found on PATH',
    wrap(request, policy) {
      return wrapWithBubblewrap(request, policy);
    },
  };
}

/**
 * Bubblewrap wrap. Profile controls FS shape:
 * - strict: platform RO binds + workspace RW
 * - balanced/permissive: RO bind whole `/` (high tool success) + workspace RW
 */
export function wrapWithBubblewrap(
  request: ProcessExecRequest,
  policy: SandboxPolicy,
): ProcessExecRequest {
  const scrubbed = scrubSandboxedEnv(request, policy);
  const [command, ...args] = scrubbed.argv;
  if (!command) return scrubbed;

  const profile = policy.isolationProfile ?? 'balanced';
  const bindArgs: string[] = [
    '--die-with-parent',
    '--dev',
    '/dev',
    '--proc',
    '/proc',
    '--tmpfs',
    '/tmp',
  ];

  if (profile === 'strict') {
    for (const path of LINUX_PLATFORM_READ_PATHS) {
      if (existsSync(path)) {
        bindArgs.push('--ro-bind', path, path);
      }
    }
    for (const path of policy.readablePaths ?? []) {
      if (existsSync(path)) {
        bindArgs.push('--ro-bind', path, path);
      }
    }
  } else {
    bindArgs.push('--ro-bind', '/', '/');
  }

  bindArgs.push('--bind', policy.workspaceRoot, policy.workspaceRoot);
  for (const extra of policy.writablePaths ?? []) {
    if (existsSync(extra)) {
      bindArgs.push('--bind', extra, extra);
    }
  }

  for (const denyPath of policy.denyReadPaths ?? []) {
    if (!existsSync(denyPath)) continue;
    try {
      if (statSync(denyPath).isDirectory()) {
        bindArgs.push('--tmpfs', denyPath);
      } else {
        bindArgs.push('--ro-bind', '/dev/null', denyPath);
      }
    } catch {
      // Race / permission — skip overlay for this path.
    }
  }

  if (policy.network === 'deny') {
    bindArgs.push('--unshare-net');
  }

  return {
    ...scrubbed,
    argv: ['bwrap', ...bindArgs, command, ...args],
  };
}
