import { DEFAULT_MAX_CODE_NAVIGATION_LOCATIONS } from "./defaults";

export const CODE_NAVIGATION_POLICY = {
  maximumLocations: DEFAULT_MAX_CODE_NAVIGATION_LOCATIONS,
  graphEdgeTypes: ["calls", "references", "declares", "extends", "implements"] as const,
} as const;
