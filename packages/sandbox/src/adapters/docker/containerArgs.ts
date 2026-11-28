import { spawnSync } from 'node:child_process';

import {
  DEFAULT_SANDBOX_IMAGE,
  SANDBOX_IMAGE_CANDIDATES,
} from '../../constants.js';
import type { SandboxPolicy } from '../../contracts/policy.js';
import { resolveSandboxResources } from '../../contracts/policy.js';
import { commandExists } from '../../helpers/commandExists.js';
import { toVolumeSpec } from '../../helpers/containerPaths.js';

/**
 * Resolve container image: explicit env → preferred candidates → alpine.
 * `probeLocal` when true skips candidates that `docker/podman image inspect`
 * cannot see (best-effort; falls back to last candidate).
 */
export function resolveSandboxImage(
  env: NodeJS.ProcessEnv = process.env,
  options?: { runtime?: 'docker' | 'podman'; probeLocal?: boolean },
): string {
  const explicit = env.MITII_SANDBOX_IMAGE?.trim();
  if (explicit) return explicit;

  if (options?.probeLocal) {
    const runtime =
      options.runtime ??
      (commandExists('docker')
        ? 'docker'
        : commandExists('podman')
          ? 'podman'
          : undefined);
    if (runtime) {
      for (const candidate of SANDBOX_IMAGE_CANDIDATES) {
        if (imageExistsLocally(runtime, candidate)) {
          return candidate;
        }
      }
    }
  }

  return env.MITII_SANDBOX_IMAGE_FALLBACK?.trim() || DEFAULT_SANDBOX_IMAGE;
}

function imageExistsLocally(
  runtime: 'docker' | 'podman',
  image: string,
): boolean {
  const probe = spawnSync(runtime, ['image', 'inspect', image], {
    encoding: 'utf8',
    timeout: 5000,
    shell: false,
  });
  return probe.status === 0;
}

/** Shared volume / network / resource flags for create and ephemeral run. */
export function buildContainerIsolationArgs(
  policy: SandboxPolicy,
  env: NodeJS.ProcessEnv = process.env,
): string[] {
  const resources = resolveSandboxResources(policy.resources, env);
  const networkArgs =
    policy.network === 'deny' ? (['--network', 'none'] as const) : [];
  const volumeArgs: string[] = [
    '-v',
    toVolumeSpec(policy.workspaceRoot),
  ];
  for (const extra of policy.writablePaths ?? []) {
    volumeArgs.push('-v', toVolumeSpec(extra));
  }
  return [
    '--memory',
    resources.memory,
    '--cpus',
    resources.cpus,
    '--pids-limit',
    String(resources.pidsLimit),
    ...networkArgs,
    ...volumeArgs,
  ];
}
