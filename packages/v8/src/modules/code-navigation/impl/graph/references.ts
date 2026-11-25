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

/** Port method: `references`. */
export async function graphReferences(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
): Promise<readonly CodeNavigationLocation[]> {
  const graphs = await loadGraphs();
  const symbols = await resolveSymbols(loadGraphs, input, graphs);
  const symbolIds = new Set(symbols.map((symbol) => symbol.node.id));
  const locations: CodeNavigationLocation[] = [];

  if (input.includeDeclaration !== false) {
    locations.push(
      ...symbols.map((symbol) => toLocation(symbol.file, symbol.node)),
    );
  }

  for (const graph of graphs) {
    const files = fileIndex(graph);
    const nodes = symbolIndex(graph);
    for (const edge of graph.edges) {
      if (
        !CODE_NAVIGATION_POLICY.graphEdgeTypes.includes(
          edge.type as (typeof CODE_NAVIGATION_POLICY.graphEdgeTypes)[number],
        )
      ) {
        continue;
      }
      const relatedId = symbolIds.has(edge.toNodeId)
        ? edge.fromNodeId
        : symbolIds.has(edge.fromNodeId)
          ? edge.toNodeId
          : undefined;
      if (!relatedId) {
        continue;
      }
      const related = nodes.get(relatedId);
      const file = related ? files.get(related.fileId) : undefined;
      if (!related || !file) {
        continue;
      }
      locations.push(toLocation(file, related, edge.evidence[0]?.line));
    }
  }

  return uniqueLocations(locations);
}
