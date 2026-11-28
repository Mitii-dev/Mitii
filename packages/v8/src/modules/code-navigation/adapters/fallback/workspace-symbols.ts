import type {
  CodeNavigationCallOptions,
  CodeNavigationLocation,
  CodeNavigationPort,
  CodeNavigationWorkspaceQuery,
} from "../../contracts";
import {
  firstNonEmptyLocations,
  type FallbackProviderSink,
} from "./first-non-empty";

/** Port method: `workspaceSymbols` (primary → fallback). */
export async function fallbackWorkspaceSymbols(params: {
  primary: CodeNavigationPort;
  fallback: CodeNavigationPort;
  sink: FallbackProviderSink;
  input: CodeNavigationWorkspaceQuery;
  options?: CodeNavigationCallOptions;
}): Promise<readonly CodeNavigationLocation[]> {
  return firstNonEmptyLocations({
    primary: params.primary,
    fallback: params.fallback,
    sink: params.sink,
    runPrimary: () =>
      params.primary.workspaceSymbols?.(params.input, params.options) ??
      Promise.resolve([]),
    runFallback: () =>
      params.fallback.workspaceSymbols?.(params.input, params.options) ??
      Promise.resolve([]),
  });
}
