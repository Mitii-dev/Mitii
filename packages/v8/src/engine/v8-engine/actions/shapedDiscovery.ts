/**
 * Shaped discovery profiles — v8 re-export surface.
 * Early pipeline still runs discovery via agent-engine pinAndDiscovery;
 * Phase 6 adds monorepo / security / testing profiles to the shared registry.
 */
export {
  SHAPED_DISCOVERY_PROFILES,
  resolveShapedDiscoveryProfile,
  createShapedDiscoveryProfile,
  monorepoDiscoveryProfile,
  securityDiscoveryProfile,
  testingDiscoveryProfile,
  apiBackendDiscoveryProfile,
  authDiscoveryProfile,
  browserTestRunnerDiscoveryProfile,
  buildConfigDiscoveryProfile,
  ciCdDiscoveryProfile,
  databaseDiscoveryProfile,
  frontendComponentDiscoveryProfile,
} from "../../agent-engine/actions/shapedDiscovery";
export type {
  ShapedDiscoveryProfile,
  CreateShapedDiscoveryProfileInput,
  PathScoreRule,
} from "../../agent-engine/actions/shapedDiscovery";
