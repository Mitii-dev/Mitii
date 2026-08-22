import { apiBackendDiscoveryProfile } from "./profiles/apiBackend";
import { authDiscoveryProfile } from "./profiles/auth";
import { browserTestRunnerDiscoveryProfile } from "./profiles/browserTestRunner";
import { buildConfigDiscoveryProfile } from "./profiles/buildConfig";
import { ciCdDiscoveryProfile } from "./profiles/ciCd";
import { databaseDiscoveryProfile } from "./profiles/database";
import { frontendComponentDiscoveryProfile } from "./profiles/frontendComponent";
import type { ShapedDiscoveryProfile } from "./types";

/**
 * Register domain profiles here — discovery loop stays generic.
 * When priorities tie, the earlier entry wins (stable sort).
 */
export const SHAPED_DISCOVERY_PROFILES: readonly ShapedDiscoveryProfile[] = [
  browserTestRunnerDiscoveryProfile,
  ciCdDiscoveryProfile,
  authDiscoveryProfile,
  apiBackendDiscoveryProfile,
  databaseDiscoveryProfile,
  frontendComponentDiscoveryProfile,
  buildConfigDiscoveryProfile,
];

export function resolveShapedDiscoveryProfile(
  query: string,
): ShapedDiscoveryProfile | undefined {
  const matches = SHAPED_DISCOVERY_PROFILES.filter((profile) =>
    profile.matchesQuery(query),
  );
  if (matches.length === 0) {
    return undefined;
  }
  return [...matches].sort((left, right) => right.priority - left.priority)[0];
}
