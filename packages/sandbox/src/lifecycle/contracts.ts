import { z } from 'zod';

import {
  SANDBOX_LIFECYCLE_MODES,
  type SandboxLifecycleMode,
} from '../constants.js';

export const sandboxLifecycleModeSchema = z.enum(SANDBOX_LIFECYCLE_MODES);
export type { SandboxLifecycleMode };

export const sandboxSessionStatusSchema = z.enum([
  'missing',
  'created',
  'running',
  'paused',
  'exited',
  'error',
]);
export type SandboxSessionStatus = z.infer<typeof sandboxSessionStatusSchema>;

export type SandboxSessionInfo = {
  containerName: string;
  runtime: 'docker' | 'podman';
  status: SandboxSessionStatus;
  workspaceRoot: string;
};

export type ContainerRuntimeKind = 'docker' | 'podman';
