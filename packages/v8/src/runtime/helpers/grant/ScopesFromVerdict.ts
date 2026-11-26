import type { ScopeVerdict } from "../../contracts/orient/ScopeVerdict";

/**
 * Compile grant path knobs from ScopeVerdict (S2-SCOPE / S2C-SCOPES).
 * Reads stay workspace-wide; writes use mutationFence only when set.
 * Dual-writes legacy pathScopes + unified scopes.readPaths/writePaths.
 */
export function scopesFromVerdict(scope: ScopeVerdict | undefined): {
  pathScopes: string[];
  mutationPathScopes: string[] | undefined;
  scopes: {
    readPaths: string[];
    writePaths?: string[];
    protectedPaths?: string[];
  };
  reasonCodes: string[];
} {
  const reasonCodes: string[] = ["scopes_from_verdict"];
  if (!scope) {
    return {
      pathScopes: ["."],
      mutationPathScopes: undefined,
      scopes: { readPaths: ["."] },
      reasonCodes: [...reasonCodes, "scopes_verdict_missing"],
    };
  }

  if (scope.mutationFence && scope.mutationFence.length > 0) {
    reasonCodes.push("scopes_verdict_mutation_fence");
    const fence = [...scope.mutationFence];
    return {
      pathScopes: ["."],
      mutationPathScopes: fence,
      scopes: {
        readPaths: ["."],
        writePaths: fence,
      },
      reasonCodes,
    };
  }

  reasonCodes.push("scopes_focus_not_fence");
  return {
    pathScopes: ["."],
    mutationPathScopes: undefined,
    scopes: { readPaths: ["."] },
    reasonCodes,
  };
}
