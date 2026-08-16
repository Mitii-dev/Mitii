import type { ToolGrant } from "../contracts";

/**
 * Structural equality for grants after discovery narrowing.
 * Order of allow-lists and path scopes is not significant.
 */
export function toolGrantsEquivalent(a: ToolGrant, b: ToolGrant): boolean {
  return (
    JSON.stringify(normalizeGrantForCompare(a)) ===
    JSON.stringify(normalizeGrantForCompare(b))
  );
}

function normalizeGrantForCompare(grant: ToolGrant): ToolGrant {
  return {
    ...grant,
    allowedTools: [...grant.allowedTools].sort(),
    allowedEffects: [...grant.allowedEffects].sort(),
    pathScopes: [...grant.pathScopes].sort(),
    networkHosts: grant.networkHosts
      ? [...grant.networkHosts].sort()
      : undefined,
  };
}
