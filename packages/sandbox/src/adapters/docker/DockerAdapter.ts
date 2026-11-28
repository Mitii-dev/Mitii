import type { ProcessExecRequest } from '@mitii/v8';

import type { SandboxBackend, SandboxPolicy } from '../../contracts/policy.js';
import { commandExists } from '../../helpers/commandExists.js';
import { mapCwdToContainer } from '../../helpers/containerPaths.js';
import { scrubSandboxedEnv } from '../../helpers/envScrub.js';
import {
  buildContainerIsolationArgs,
  resolveSandboxImage,
} from './containerArgs.js';

export function resolveDockerBackend(
  runtime: 'docker' | 'podman' = 'docker',
): SandboxBackend {
  const available = commandExists(runtime);
  return {
    id: runtime,
    available,
    reason: available ? undefined : `${runtime} not found on PATH`,
    wrap(request, policy) {
      return wrapWithContainer(runtime, request, policy);
    },
  };
}

export function wrapWithContainer(
  runtime: 'docker' | 'podman',
  request: ProcessExecRequest,
  policy: SandboxPolicy,
): ProcessExecRequest {
  const scrubbed = scrubSandboxedEnv(request, policy);
  const [command, ...args] = scrubbed.argv;
  if (!command) return scrubbed;

  const cwd = mapCwdToContainer({
    cwd: scrubbed.cwd,
    workspaceRoot: policy.workspaceRoot,
  });

  return {
    ...scrubbed,
    argv: [
      runtime,
      'run',
      '--rm',
      '-i',
      ...buildContainerIsolationArgs(policy),
      '-w',
      cwd,
      resolveSandboxImage(process.env, {
        runtime,
        probeLocal: true,
      }),
      command,
      ...args,
    ],
  };
}
