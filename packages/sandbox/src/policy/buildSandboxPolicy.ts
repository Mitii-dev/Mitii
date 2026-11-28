import type {
  SandboxIsolationProfile,
  SandboxNetworkMode,
  SandboxPolicy,
  SandboxResources,
} from '../contracts/policy.js';
import { resolveSandboxPolicy } from '../contracts/policy.js';
import {
  projectGrantToOsPolicy,
  type SandboxGrantScopesInput,
} from './projectGrantToOsPolicy.js';

/**
 * Relative paths denied for read under an enabled sandbox (package floor).
 * Does not replace ToolGrant path checks — only OS wrap tightening.
 */
export const SANDBOX_DEFAULT_DENY_READ_RELATIVE: readonly string[] = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.production',
  '.aws',
  '.ssh',
];

export type BuildSandboxPolicyInput = {
  workspaceRoot: string;
  enabled?: boolean;
  network?: SandboxNetworkMode;
  writablePaths?: string[];
  readablePaths?: string[];
  denyReadPaths?: string[];
  resources?: SandboxResources;
  isolationProfile?: SandboxIsolationProfile;
  extraEnvDenyPatterns?: string[];
  /** Optional grant/safety scopes to project (tighten-only). */
  scopes?: SandboxGrantScopesInput;
  /**
   * When true (default if sandbox enabled), apply
   * {@link SANDBOX_DEFAULT_DENY_READ_RELATIVE}.
   */
  applyDefaultDenyReadPaths?: boolean;
  /**
   * Extra protected relative paths (e.g. from host safety.json).
   * Applied after the default floor; tighten-only.
   */
  protectedPathGlobs?: readonly string[];
};

/**
 * Compose OS sandbox policy: base options, default deny-read floor,
 * optional protected globs, optional grant scopes.
 * Host-neutral — no filesystem safety.json reads here.
 */
export function buildSandboxPolicy(
  input: BuildSandboxPolicyInput,
): SandboxPolicy {
  const enabled = input.enabled === true;
  let policy = resolveSandboxPolicy({
    enabled,
    network: input.network ?? 'deny',
    workspaceRoot: input.workspaceRoot,
    isolationProfile: input.isolationProfile ?? 'balanced',
    ...(input.writablePaths ? { writablePaths: input.writablePaths } : {}),
    ...(input.readablePaths ? { readablePaths: input.readablePaths } : {}),
    ...(input.denyReadPaths ? { denyReadPaths: input.denyReadPaths } : {}),
    ...(input.resources ? { resources: input.resources } : {}),
    ...(input.extraEnvDenyPatterns
      ? { extraEnvDenyPatterns: input.extraEnvDenyPatterns }
      : {}),
  });

  if (!enabled) {
    return policy;
  }

  const applyDefaults = input.applyDefaultDenyReadPaths !== false;
  if (applyDefaults) {
    policy = projectGrantToOsPolicy(policy, {
      protectedPaths: [...SANDBOX_DEFAULT_DENY_READ_RELATIVE],
    });
  }

  if (input.protectedPathGlobs && input.protectedPathGlobs.length > 0) {
    policy = projectGrantToOsPolicy(policy, {
      protectedPathGlobs: input.protectedPathGlobs,
    });
  }

  if (input.scopes) {
    policy = projectGrantToOsPolicy(policy, input.scopes);
  }

  return policy;
}
