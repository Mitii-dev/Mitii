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

/** Port method: `typeDefinition` (primary → fallback). */
export async function fallbackTypeDefinition(params: {
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
    runPrimary: () =>
      params.primary.typeDefinition?.(params.input, params.options) ??
      Promise.resolve([]),
    runFallback: () =>
      params.fallback.typeDefinition?.(params.input, params.options) ??
      Promise.resolve([]),
  });
}
