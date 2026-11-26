import type { GrantSurface } from "./CheckToolAgainstGrant";

/**
 * Prompt tool list must be ⊆ grant.allowedTools — never a second allowlist.
 */
export function toModelToolSurface(grant: GrantSurface): string[] {
  return [...(grant.allowedTools ?? [])];
}
