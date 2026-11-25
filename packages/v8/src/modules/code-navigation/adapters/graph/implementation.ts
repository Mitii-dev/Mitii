import type {
  CodeNavigationLocation,
  CodeNavigationQuery,
} from "../../contracts";
import { CODE_NAVIGATION_POLICY } from "../../rules";
import {
  fileIndex,
  resolveSymbols,
  symbolIndex,
  toLocation,
  uniqueLocations,
  type GraphLoadGraphs,
} from "./helpers";

/** Port method: `implementation`. */
export async function graphImplementation(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
): Promise<readonly CodeNavigationLocation[]> {
  const graphs = await loadGraphs();
  const symbols = await resolveSymbols(loadGraphs, input, graphs);
  let frontier = new Set(symbols.map((symbol) => symbol.node.id));
  const locations: CodeNavigationLocation[] = [];
  const seen = new Set(frontier);

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
        if (edge.type !== "implements" && edge.type !== "extends") {
          continue;
        }
        if (!frontier.has(edge.toNodeId) || seen.has(edge.fromNodeId)) {
          continue;
        }
        const related = nodes.get(edge.fromNodeId);
        const file = related ? files.get(related.fileId) : undefined;
        if (!related || !file) {
          continue;
        }
        seen.add(edge.fromNodeId);
        next.add(edge.fromNodeId);
        locations.push(toLocation(file, related));
      }
    }
    frontier = next;
  }

  return uniqueLocations(locations);
}
