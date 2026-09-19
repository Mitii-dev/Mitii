import type { ToolGrant } from "../../../modules/decision-policy";

import { PathContainmentError } from "../internal/PathContainment";

/**
 * When the grant carries mutationRelativePathRegex (mode profiles), reject
 * mutation paths that do not match. Tighten-only — never widens scopes.
 */
export function assertMutationPathMatchesGrant(params: {
  relativePath: string;
  grant: ToolGrant;
}): void {
  const pattern = params.grant.mutationRelativePathRegex;
  if (!pattern) {
    return;
  }

  let regex: RegExp;
  try {
    regex = new RegExp(pattern);
  } catch {
    throw new PathContainmentError(
      "path_out_of_scope",
      `Invalid mutationRelativePathRegex on grant: ${pattern}`,
    );
  }

  const normalized = params.relativePath.replace(/\\/g, "/");
  if (!regex.test(normalized)) {
    throw new PathContainmentError(
      "path_out_of_scope",
      `Path "${normalized}" does not match mutationRelativePathRegex /${pattern}/.`,
    );
  }
}
