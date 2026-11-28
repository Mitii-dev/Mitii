import {
  buildSandboxPolicy,
  SANDBOX_DEFAULT_DENY_READ_RELATIVE,
  type BuildSandboxPolicyInput,
  type SandboxGrantScopesInput,
  type SandboxIsolationProfile,
  type SandboxNetworkMode,
  type SandboxPolicy,
  type SandboxResources,
} from '@mitii/sandbox';

import {
  loadUserSafetyRules,
  withDefaultProtectedPaths,
} from '../safety/loadUserSafetyRules.js';

export { SANDBOX_DEFAULT_DENY_READ_RELATIVE };

export type BuildHostSandboxPolicyInput = {
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
   * When true (default), merge `.mitii/safety.json` protected globs if that
   * file enables user safety rules.
   */
  applyUserSafetyProtectedPaths?: boolean;
  /**
   * When true (default if sandbox enabled), apply
   * {@link SANDBOX_DEFAULT_DENY_READ_RELATIVE}.
   */
  applyDefaultDenyReadPaths?: boolean;
};

/**
 * Host glue: {@link buildSandboxPolicy} + optional `.mitii/safety.json`
 * protected paths. OS isolation lives in `@mitii/sandbox`.
 */
export function buildHostSandboxPolicy(
  input: BuildHostSandboxPolicyInput,
): SandboxPolicy {
  const enabled = input.enabled === true;

  let protectedPathGlobs: readonly string[] | undefined;
  if (enabled && input.applyUserSafetyProtectedPaths !== false) {
    const safety = withDefaultProtectedPaths(
      loadUserSafetyRules(input.workspaceRoot),
    );
    if (safety.enabled && safety.protectedPathGlobs.length > 0) {
      protectedPathGlobs = safety.protectedPathGlobs;
    }
  }

  const base: BuildSandboxPolicyInput = {
    workspaceRoot: input.workspaceRoot,
    enabled,
    network: input.network ?? 'deny',
    isolationProfile: input.isolationProfile ?? 'balanced',
    ...(input.writablePaths ? { writablePaths: input.writablePaths } : {}),
    ...(input.readablePaths ? { readablePaths: input.readablePaths } : {}),
    ...(input.denyReadPaths ? { denyReadPaths: input.denyReadPaths } : {}),
    ...(input.resources ? { resources: input.resources } : {}),
    ...(input.extraEnvDenyPatterns
      ? { extraEnvDenyPatterns: input.extraEnvDenyPatterns }
      : {}),
    ...(input.scopes ? { scopes: input.scopes } : {}),
    ...(input.applyDefaultDenyReadPaths !== undefined
      ? { applyDefaultDenyReadPaths: input.applyDefaultDenyReadPaths }
      : {}),
    ...(protectedPathGlobs ? { protectedPathGlobs } : {}),
  };

  return buildSandboxPolicy(base);
}
