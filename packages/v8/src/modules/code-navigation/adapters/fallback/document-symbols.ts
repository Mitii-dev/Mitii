import type {
  CodeNavigationCallOptions,
  CodeNavigationDocumentQuery,
  CodeNavigationLocation,
  CodeNavigationPort,
} from "../../contracts";
import {
  firstNonEmptyLocations,
  type FallbackProviderSink,
} from "./first-non-empty";

/** Port method: `documentSymbols` (primary → fallback). */
export async function fallbackDocumentSymbols(params: {
  primary: CodeNavigationPort;
  fallback: CodeNavigationPort;
  sink: FallbackProviderSink;
  input: CodeNavigationDocumentQuery;
  options?: CodeNavigationCallOptions;
}): Promise<readonly CodeNavigationLocation[]> {
  return firstNonEmptyLocations({
    primary: params.primary,
    fallback: params.fallback,
    sink: params.sink,
    runPrimary: () =>
      params.primary.documentSymbols?.(params.input, params.options) ??
      Promise.resolve([]),
    runFallback: () =>
      params.fallback.documentSymbols?.(params.input, params.options) ??
      Promise.resolve([]),
  });
}
