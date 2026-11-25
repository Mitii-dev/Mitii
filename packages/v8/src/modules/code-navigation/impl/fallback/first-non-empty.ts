import type { CodeNavigationLocation, CodeNavigationPort } from "../../types";

export type FallbackProviderSink = {
  provider: "language_server" | "repo_graph";
};

/** Try primary locations, then fallback; update provider sink. */
export async function firstNonEmptyLocations(params: {
  primary: CodeNavigationPort;
  fallback: CodeNavigationPort;
  sink: FallbackProviderSink;
  runPrimary: () => Promise<readonly CodeNavigationLocation[]>;
  runFallback: () => Promise<readonly CodeNavigationLocation[]>;
}): Promise<readonly CodeNavigationLocation[]> {
  try {
    const locations = await params.runPrimary();
    if (locations.length > 0) {
      params.sink.provider = params.primary.provider;
      return locations;
    }
  } catch {
    // Language servers can fail closed; graph remains available.
  }
  params.sink.provider = params.fallback.provider;
  return params.runFallback();
}
