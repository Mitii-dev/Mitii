/**
 * Dual-write unified scopes from legacy pathScopes / mutationPathScopes (S2C-SCOPES).
 * Precedence: protectedPaths > writePaths > readPaths.
 */

import type { ToolGrant } from "../contracts";

export interface UnifiedGrantScopes {
  readPaths: string[];
  writePaths?: string[];
  protectedPaths?: string[];
  commandPrefixes?: string[];
  networkHosts?: string[];
  mcpServerIds?: string[];
  extraAllowedRoots?: string[];
}

export function deriveUnifiedScopes(grant: ToolGrant): UnifiedGrantScopes {
  const commandPrefixes = (grant.commandRules ?? [])
    .flatMap((rule) => rule.prefixes)
    .filter(Boolean);
  return {
    readPaths:
      grant.pathScopes.length > 0 ? [...grant.pathScopes] : ["."],
    ...(grant.mutationPathScopes && grant.mutationPathScopes.length > 0
      ? { writePaths: [...grant.mutationPathScopes] }
      : {}),
    ...(grant.protectedPathGlobs && grant.protectedPathGlobs.length > 0
      ? { protectedPaths: [...grant.protectedPathGlobs] }
      : {}),
    ...(commandPrefixes.length > 0 ? { commandPrefixes } : {}),
    ...(grant.networkHosts && grant.networkHosts.length > 0
      ? { networkHosts: [...grant.networkHosts] }
      : {}),
    ...(grant.allowedMcpServerIds && grant.allowedMcpServerIds.length > 0
      ? { mcpServerIds: [...grant.allowedMcpServerIds] }
      : {}),
    ...(grant.extraAllowedRoots && grant.extraAllowedRoots.length > 0
      ? { extraAllowedRoots: [...grant.extraAllowedRoots] }
      : {}),
  };
}

/** Ensure ToolGrant.scopes is populated without dropping legacy fields. */
export function attachUnifiedScopes(grant: ToolGrant): ToolGrant {
  if (grant.scopes?.readPaths && grant.scopes.readPaths.length > 0) {
    return grant;
  }
  return {
    ...grant,
    scopes: deriveUnifiedScopes(grant),
  };
}
