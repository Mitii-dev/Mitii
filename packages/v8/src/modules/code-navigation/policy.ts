import {
  DEFAULT_GRAPH_HOP_DEPTH,
  DEFAULT_MAX_CODE_NAVIGATION_LOCATIONS,
  DEFAULT_NAVIGATION_REQUEST_LIMIT,
  DEFAULT_NAVIGATION_REQUEST_TIMEOUT_MS,
} from "./defaults";

export const CODE_NAVIGATION_POLICY = {
  maximumLocations: DEFAULT_MAX_CODE_NAVIGATION_LOCATIONS,
  graphHopDepth: DEFAULT_GRAPH_HOP_DEPTH,
  requestLimit: DEFAULT_NAVIGATION_REQUEST_LIMIT,
  requestTimeoutMs: DEFAULT_NAVIGATION_REQUEST_TIMEOUT_MS,
  graphEdgeTypes: ["calls", "references", "declares", "extends", "implements"] as const,
} as const;
