import type {
  CodeNavigationCallOptions,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
} from "../../contracts";
import {
  firstNonEmptyLocations,
  type FallbackProviderSink,
} from "./first-non-empty";

/** Port method: `references` (primary → fallback). */
export async function fallbackReferences(params: {
  primary: CodeNavigationPort;
  fallback: CodeNavigationPort;
  sink: FallbackProviderSink;
  input: CodeNavigationQuery;
  options?: CodeNavigationCallOptions;
}): Promise<readonly CodeNavigationLocation[]> {
  return firstNonEmptyLocations({
    primary: params.primary,
    fallback: params.fallback,
    sink: params.sink,
    runPrimary: () => params.primary.references(params.input, params.options),
    runFallback: () =>
      params.fallback.references(params.input, params.options),
  });
}
