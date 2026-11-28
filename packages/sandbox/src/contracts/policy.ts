import { z } from 'zod';

import type { ProcessExecRequest } from '@mitii/v8';

import {
  DEFAULT_SANDBOX_RESOURCES,
  SANDBOX_ISOLATION_PROFILES,
} from '../constants.js';

export const sandboxNetworkModeSchema = z.enum(['deny', 'allow']);
export type SandboxNetworkMode = z.infer<typeof sandboxNetworkModeSchema>;

export const sandboxIsolationProfileSchema = z.enum(SANDBOX_ISOLATION_PROFILES);
export type SandboxIsolationProfile = z.infer<
  typeof sandboxIsolationProfileSchema
>;

export const sandboxBackendIdSchema = z.enum([
  'seatbelt',
  'bubblewrap',
  'docker',
  'podman',
  'unavailable',
]);
export type SandboxBackendId = z.infer<typeof sandboxBackendIdSchema>;

export const sandboxBackendPreferSchema = z.enum([
  'auto',
  'docker',
  'podman',
  'seatbelt',
  'bubblewrap',
]);
export type SandboxBackendPrefer = z.infer<typeof sandboxBackendPreferSchema>;

export const sandboxResourcesSchema = z.object({
  memory: z.string().min(1).optional(),
  cpus: z.string().min(1).optional(),
  pidsLimit: z.number().int().positive().optional(),
});
export type SandboxResources = z.infer<typeof sandboxResourcesSchema>;

export const sandboxPolicySchema = z.object({
  enabled: z.boolean(),
  network: sandboxNetworkModeSchema,
  writablePaths: z.array(z.string().min(1)).default([]),
  workspaceRoot: z.string().min(1),
  /** Extra absolute paths the child may read (beyond workspace + platform defaults). */
  readablePaths: z.array(z.string().min(1)).optional(),
  /** Absolute paths denied for read even under readable roots. */
  denyReadPaths: z.array(z.string().min(1)).optional(),
  resources: sandboxResourcesSchema.optional(),
  /** When true (default under enabled), scrub loader-hijack env keys. */
  scrubEnv: z.boolean().optional(),
  /** FS tightness. Default balanced for tool success rate. */
  isolationProfile: sandboxIsolationProfileSchema.optional(),
  /** Extra secret env glob patterns (strict/balanced only). */
  extraEnvDenyPatterns: z.array(z.string().min(1)).optional(),
});
export type SandboxPolicy = z.infer<typeof sandboxPolicySchema>;

export interface SandboxBackend {
  readonly id: SandboxBackendId;
  readonly available: boolean;
  readonly reason?: string;
  wrap(request: ProcessExecRequest, policy: SandboxPolicy): ProcessExecRequest;
}

export function resolveSandboxPolicy(options: {
  enabled?: boolean;
  network?: SandboxNetworkMode;
  writablePaths?: string[];
  readablePaths?: string[];
  denyReadPaths?: string[];
  workspaceRoot: string;
  resources?: SandboxResources;
  scrubEnv?: boolean;
  isolationProfile?: SandboxIsolationProfile;
  extraEnvDenyPatterns?: string[];
}): SandboxPolicy {
  return sandboxPolicySchema.parse({
    enabled: options.enabled === true,
    network: options.network === 'allow' ? 'allow' : 'deny',
    writablePaths: options.writablePaths ?? [],
    workspaceRoot: options.workspaceRoot,
    isolationProfile: options.isolationProfile ?? 'balanced',
    ...(options.readablePaths ? { readablePaths: options.readablePaths } : {}),
    ...(options.denyReadPaths ? { denyReadPaths: options.denyReadPaths } : {}),
    ...(options.resources ? { resources: options.resources } : {}),
    ...(options.scrubEnv !== undefined ? { scrubEnv: options.scrubEnv } : {}),
    ...(options.extraEnvDenyPatterns
      ? { extraEnvDenyPatterns: options.extraEnvDenyPatterns }
      : {}),
  });
}

export function resolveSandboxResources(
  resources: SandboxResources | undefined,
  env: NodeJS.ProcessEnv = process.env,
): Required<Pick<SandboxResources, 'memory' | 'cpus'>> & {
  pidsLimit: number;
} {
  const parsedPids = env.MITII_SANDBOX_PIDS_LIMIT
    ? Number.parseInt(env.MITII_SANDBOX_PIDS_LIMIT, 10)
    : Number.NaN;
  return {
    memory:
      resources?.memory?.trim() ||
      env.MITII_SANDBOX_MEMORY?.trim() ||
      DEFAULT_SANDBOX_RESOURCES.memory,
    cpus:
      resources?.cpus?.trim() ||
      env.MITII_SANDBOX_CPUS?.trim() ||
      DEFAULT_SANDBOX_RESOURCES.cpus,
    pidsLimit:
      resources?.pidsLimit ??
      (Number.isFinite(parsedPids) && parsedPids > 0
        ? parsedPids
        : DEFAULT_SANDBOX_RESOURCES.pidsLimit),
  };
}
