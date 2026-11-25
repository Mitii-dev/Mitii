import type {
  CodeNavigationLocation,
  CodeNavigationQuery,
} from "../../contracts";
import {
  resolveSymbols,
  toLocation,
  uniqueLocations,
  type GraphLoadGraphs,
} from "./helpers";

/** Port method: `definition`. */
export async function graphDefinition(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
): Promise<readonly CodeNavigationLocation[]> {
  const symbols = await resolveSymbols(loadGraphs, input);
  return uniqueLocations(
    symbols.map((symbol) => toLocation(symbol.file, symbol.node)),
  );
}
