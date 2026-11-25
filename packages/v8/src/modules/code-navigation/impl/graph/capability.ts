import { CODE_NAVIGATION_OPERATIONS } from "../../constants";
import type { CodeNavigationCapability } from "../../types";

/** Port method: `capability`. */
export function graphCapability(): CodeNavigationCapability {
  return {
    status: "degraded",
    provider: "repo_graph",
    reason: "language_server_not_configured",
    operations: CODE_NAVIGATION_OPERATIONS,
  };
}
