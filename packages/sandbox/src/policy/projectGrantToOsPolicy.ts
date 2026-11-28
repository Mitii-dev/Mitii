import type { SandboxPolicy } from '../contracts/policy.js';
import {
  filterUnderWorkspace,
  resolveScopeList,
} from '../helpers/resolveScopePaths.js';

/**
 * Grant-like scopes used to tighten OS sandbox policy.
 * Structural (not a full ToolGrant) so hosts can pass start-time safety
 * overlays without importing decision-policy internals.
 */
export type SandboxGrantScopesInput = {
  readPaths?: readonly string[];
  writePaths?: readonly string[];
  protectedPaths?: readonly string[];
  /** @deprecated Prefer readPaths */
  pathScopes?: readonly string[];
  /** @deprecated Prefer writePaths */
  mutationPathScopes?: readonly string[];
  /** @deprecated Prefer protectedPaths */
  protectedPathGlobs?: readonly string[];
  extraAllowedRoots?: readonly string[];
  networkHosts?: readonly string[];
  /**
   * When provided, absence of `network_access` forces process network deny
   * (never widens a deny base).
   */
  allowedEffects?: readonly string[];
};

function unique(paths: readonly string[]): string[] {
  return [...new Set(paths)];
}

function intersectPaths(
  base: readonly string[],
  grant: readonly string[],
): string[] {
  if (grant.length === 0) return [...base];
  if (base.length === 0) return [...grant];
  const grantSet = new Set(grant);
  const hit = base.filter((p) => grantSet.has(p));
  // If base extras do not overlap grant, prefer grant writes (tighten).
  return hit.length > 0 ? hit : [...grant];
}

/**
 * Project grant/safety scopes onto an OS sandbox policy.
 * Tighten-only: never enables sandbox, never flips network deny→allow,
 * never removes denyRead entries already on the base policy.
 */
export function projectGrantToOsPolicy(
  base: SandboxPolicy,
  scopes: SandboxGrantScopesInput,
): SandboxPolicy {
  const root = base.workspaceRoot;

  const readScopes =
    scopes.readPaths ?? scopes.pathScopes ?? undefined;
  const writeScopes =
    scopes.writePaths ?? scopes.mutationPathScopes ?? undefined;
  const protectedScopes =
    scopes.protectedPaths ?? scopes.protectedPathGlobs ?? undefined;

  const grantReads = resolveScopeList(root, readScopes);
  const grantWrites = filterUnderWorkspace(
    root,
    resolveScopeList(root, writeScopes),
  );
  const grantProtected = filterUnderWorkspace(
    root,
    resolveScopeList(root, protectedScopes),
  );
  const extraRoots = resolveScopeList(root, scopes.extraAllowedRoots);

  const readablePaths = unique([
    ...(base.readablePaths ?? []),
    ...grantReads,
    ...extraRoots,
  ]);

  const writablePaths = unique(
    intersectPaths(base.writablePaths ?? [], grantWrites),
  );

  const denyReadPaths = unique([
    ...(base.denyReadPaths ?? []),
    ...grantProtected,
  ]);

  let network = base.network;
  if (scopes.allowedEffects !== undefined) {
    const allowsNetwork = scopes.allowedEffects.includes('network_access');
    if (!allowsNetwork) {
      network = 'deny';
    }
  }

  return {
    ...base,
    network,
    writablePaths,
    ...(readablePaths.length > 0 ? { readablePaths } : {}),
    ...(denyReadPaths.length > 0 ? { denyReadPaths } : {}),
  };
}
