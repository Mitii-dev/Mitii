import type {
  CodeNavigationCallOptions,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationQuery,
} from "../../types";
import {
  firstNonEmptyLocations,
  type FallbackProviderSink,
} from "./first-non-empty";

/** Port method: `implementation` (primary → fallback). */
export async function fallbackImplementation(params: {
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
      params.primary.implementation?.(params.input, params.options) ??
      Promise.resolve([]),
    runFallback: () =>
      params.fallback.implementation?.(params.input, params.options) ??
      Promise.resolve([]),
  });
}
