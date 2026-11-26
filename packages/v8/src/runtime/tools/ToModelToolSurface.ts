import { toModelToolSurface as toModelToolSurfaceFromPolicy } from "../../modules/decision-policy/helpers/ToModelToolSurface";
import type { GrantSurface } from "./CheckToolAgainstGrant";

/**
 * Prompt tool list must be ⊆ grant.allowedTools — never a second allowlist.
 * Owned by decision-policy; runtime re-exports for pump call sites (S2C-SURFACE).
 */
export function toModelToolSurface(grant: GrantSurface): string[] {
  return toModelToolSurfaceFromPolicy(grant);
}
