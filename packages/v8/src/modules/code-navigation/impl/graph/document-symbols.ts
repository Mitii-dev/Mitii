import type {
  CodeNavigationDocumentQuery,
  CodeNavigationLocation,
} from "../../types";
import {
  fileIndex,
  normalizeRelativePath,
  toLocation,
  uniqueLocations,
  type GraphLoadGraphs,
} from "./helpers";

/** Port method: `documentSymbols`. */
export async function graphDocumentSymbols(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationDocumentQuery,
): Promise<readonly CodeNavigationLocation[]> {
  const graphs = await loadGraphs();
  const normalizedPath = normalizeRelativePath(input.relativePath);
  const locations: CodeNavigationLocation[] = [];
  for (const graph of graphs) {
    const files = fileIndex(graph);
    for (const node of graph.nodes) {
      if (node.kind !== "symbol") {
        continue;
      }
      const file = files.get(node.fileId);
      if (!file) {
        continue;
      }
      if (normalizeRelativePath(file.relativePath) !== normalizedPath) {
        continue;
      }
      locations.push(toLocation(file, node));
    }
  }
  return uniqueLocations(locations);
}
