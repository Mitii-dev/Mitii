import type {
  CodeNavigationLocation,
  CodeNavigationQuery,
} from "../../types";
import { CODE_NAVIGATION_POLICY } from "../../rules";
import {
  fileIndex,
  resolveSymbols,
  symbolIndex,
  toLocation,
  uniqueLocations,
  type GraphLoadGraphs,
} from "./helpers";

/** Port method: `callHierarchy`. */
export async function graphCallHierarchy(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
): Promise<readonly CodeNavigationLocation[]> {
  const graphs = await loadGraphs();
  const symbols = await resolveSymbols(loadGraphs, input, graphs);
  const direction = input.direction ?? "outgoing";
  let frontier = new Set(symbols.map((symbol) => symbol.node.id));
  const locations: CodeNavigationLocation[] = [];
  const seen = new Set<string>();

  for (
    let hop = 0;
    hop < CODE_NAVIGATION_POLICY.graphHopDepth && frontier.size > 0;
    hop += 1
  ) {
    const next = new Set<string>();
    for (const graph of graphs) {
      const files = fileIndex(graph);
      const nodes = symbolIndex(graph);
      for (const edge of graph.edges) {
        if (edge.type !== "calls") {
          continue;
        }
        const fromId =
          direction === "outgoing" ? edge.fromNodeId : edge.toNodeId;
        const toId =
          direction === "outgoing" ? edge.toNodeId : edge.fromNodeId;
        if (!frontier.has(fromId) || seen.has(toId)) {
          continue;
        }
        const related = nodes.get(toId);
        const file = related ? files.get(related.fileId) : undefined;
        if (!related || !file) {
          continue;
        }
        seen.add(toId);
        next.add(toId);
        locations.push(toLocation(file, related));
      }
    }
    frontier = next;
  }

  return uniqueLocations(locations);
}
