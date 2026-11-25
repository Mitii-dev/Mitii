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

/** Port method: `callHierarchy` (primary → fallback). */
export async function fallbackCallHierarchy(params: {
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
      params.primary.callHierarchy?.(params.input, params.options) ??
      Promise.resolve([]),
    runFallback: () =>
      params.fallback.callHierarchy?.(params.input, params.options) ??
      Promise.resolve([]),
  });
}
