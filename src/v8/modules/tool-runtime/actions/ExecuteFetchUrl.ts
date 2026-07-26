import type { ToolGrant } from "../../decision-policy";

import { validateNetworkHost } from "../internal/CommandPolicy";
import { fetchUrlInputSchema } from "../internal/ToolCatalog";
import { GrantValidationError } from "./ValidateGrant";

/**
 * Phase 4: network tool is catalogued for negotiation/enforcement tests only.
 * Execution is intentionally unsupported.
 */
export async function executeFetchUrl(params: {
  arguments: unknown;
  grant: ToolGrant;
}): Promise<never> {
  const input = fetchUrlInputSchema.parse(params.arguments);

  if (!params.grant.allowedEffects.includes("network_access")) {
    throw new GrantValidationError(
      "effect_not_granted",
      'Tool "fetch_url" requires effect "network_access" which is not granted.',
    );
  }

  validateNetworkHost({
    url: input.url,
    networkHosts: params.grant.networkHosts,
  });

  throw new GrantValidationError(
    "tool_unavailable",
    'Tool "fetch_url" is catalogued but not executable in Phase 4.',
  );
}
