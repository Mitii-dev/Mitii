/**
 * Prompt tool list must be ⊆ grant.allowedTools — never a second allowlist (S2C-SURFACE).
 */

export interface GrantToolSurface {
  allowedTools?: readonly string[];
}

export function toModelToolSurface(grant: GrantToolSurface): string[] {
  return [...(grant.allowedTools ?? [])];
}
