import type { GrantSurface } from "../../tools/CheckToolAgainstGrant";

const MAX_PORT_TURNS_DEFAULT = 4;
/** Agent execute needs discovery + mutate room — 4 was burning out on reads only. */
export const MAX_PORT_TURNS_EXECUTE = 12;
const MAX_PORT_TURNS_RESEARCH = 10;

/** Host thoroughness (low/medium/high → quick/auto/deep) scales the turn budget. */
export function resolveMaxPortTurns(
  decision: { route?: string } | undefined,
  grant: GrantSurface,
  explorationDepth?: "auto" | "quick" | "deep",
): number {
  const route = decision?.route;
  const research =
    route === "repository_answer" ||
    route === "diagnose" ||
    grant.maximumWorkspaceEffect === "read";
  if (research) {
    return explorationDepth === "quick"
      ? 6
      : explorationDepth === "deep"
        ? MAX_PORT_TURNS_RESEARCH
        : 8;
  }
  if (route === "execute" || grant.maximumWorkspaceEffect === "write") {
    if (explorationDepth === "quick") return 6;
    if (explorationDepth === "deep") return 16;
    return MAX_PORT_TURNS_EXECUTE;
  }
  return MAX_PORT_TURNS_DEFAULT;
}
