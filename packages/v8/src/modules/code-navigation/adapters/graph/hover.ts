import type {
  CodeNavigationHover,
  CodeNavigationQuery,
} from "../../contracts";
import { resolveSymbols, type GraphLoadGraphs } from "./helpers";

/** Port method: `hover`. */
export async function graphHover(
  loadGraphs: GraphLoadGraphs,
  input: CodeNavigationQuery,
): Promise<CodeNavigationHover | undefined> {
  const [symbol] = await resolveSymbols(loadGraphs, input);
  if (!symbol) {
    return undefined;
  }
  const signature = symbol.node.signature?.trim();
  const contents = signature
    ? signature
    : `${symbol.node.symbolKind} ${symbol.node.name}`;
  return { contents };
}
