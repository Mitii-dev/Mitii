import type {
  CodeNavigationLocation,
  CodeNavigationWorkspaceQuery,
} from "../../types";
import {
  fileIndex,
  toLocation,
  uniqueLocations,
  type GraphLoadGraphs,
} from "./helpers";

/** Port method: `workspaceSymbols`. */
export async function graphWorkspaceSymbols(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationWorkspaceQuery,
): Promise<readonly CodeNavigationLocation[]> {
  const graphs = await loadGraphs();
  const needle = input.query.trim().toLowerCase();
  const locations: CodeNavigationLocation[] = [];
  for (const graph of graphs) {
    const files = fileIndex(graph);
    for (const node of graph.nodes) {
      if (node.kind !== "symbol") {
        continue;
      }
      if (!node.name.toLowerCase().includes(needle)) {
        continue;
      }
      const file = files.get(node.fileId);
      if (!file) {
        continue;
      }
      locations.push(toLocation(file, node));
    }
  }
  return uniqueLocations(locations);
}
