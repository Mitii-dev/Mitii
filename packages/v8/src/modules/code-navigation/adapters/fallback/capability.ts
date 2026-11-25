import { CODE_NAVIGATION_OPERATIONS } from "../../constants";
import type {
  CodeNavigationCapability,
  CodeNavigationPort,
} from "../../contracts";

/** Port method: `capability` (prefer primary). */
export function fallbackCapability(
  primary: CodeNavigationPort,
): CodeNavigationCapability {
  return (
    primary.capability?.() ?? {
      status: "available",
      provider: primary.provider,
      reason: "language_server_attached",
      operations: CODE_NAVIGATION_OPERATIONS,
    }
  );
}
