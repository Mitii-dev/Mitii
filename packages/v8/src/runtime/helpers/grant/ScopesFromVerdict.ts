import type { ScopeVerdict } from "../../contracts/orient/ScopeVerdict";

/**
 * Compile grant path knobs from ScopeVerdict (S2-SCOPE / S2C).
 * Reads stay workspace-wide; writes use mutationFence only when set.
 */
export function scopesFromVerdict(scope: ScopeVerdict | undefined): {
  pathScopes: string[];
  mutationPathScopes: string[] | undefined;
  reasonCodes: string[];
} {
  const reasonCodes: string[] = ["scopes_from_verdict"];
  if (!scope) {
    return {
      pathScopes: ["."],
      mutationPathScopes: undefined,
      reasonCodes: [...reasonCodes, "scopes_verdict_missing"],
    };
  }

  if (scope.mutationFence && scope.mutationFence.length > 0) {
    reasonCodes.push("scopes_verdict_mutation_fence");
    return {
      pathScopes: ["."],
      mutationPathScopes: [...scope.mutationFence],
      reasonCodes,
    };
  }

  reasonCodes.push("scopes_focus_not_fence");
  return {
    pathScopes: ["."],
    mutationPathScopes: undefined,
    reasonCodes,
  };
}
