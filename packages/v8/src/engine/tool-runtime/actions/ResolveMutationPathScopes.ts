import type { ToolGrant } from "../../../modules/decision-policy";

/**
 * Path scopes for mutation tools. Discovery tools keep `pathScopes`;
 * `apply_patch` / delete / move use `mutationPathScopes` when present.
 */
export function resolveMutationPathScopes(grant: ToolGrant): readonly string[] {
  if (grant.mutationPathScopes && grant.mutationPathScopes.length > 0) {
    return grant.mutationPathScopes;
  }
  return grant.pathScopes;
}
