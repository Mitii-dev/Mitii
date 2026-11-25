import type {
  CodeNavigationLocation,
  CodeNavigationQuery,
} from "../../types";
import {
  isTypeLikeSymbolKind,
  resolveSymbols,
  toLocation,
  uniqueLocations,
  type GraphLoadGraphs,
} from "./helpers";

/** Port method: `typeDefinition`. */
export async function graphTypeDefinition(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
): Promise<readonly CodeNavigationLocation[]> {
  // Graph has no typed-expression edges. Only return type-like symbols at the
  // caret; otherwise empty so callers prefer a language-service port.
  const symbols = await resolveSymbols(loadGraphs, input);
  const typed = symbols.filter((symbol) =>
    isTypeLikeSymbolKind(symbol.node.symbolKind),
  );
  return uniqueLocations(
    typed.map((symbol) => toLocation(symbol.file, symbol.node)),
  );
}
