/**
 * Shim — owner is runtime/helpers/shaped-discovery.
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
} from "../../../../runtime/helpers/shaped-discovery";
export type {
  ShapedDiscoveryProfile,
  CreateShapedDiscoveryProfileInput,
  PathScoreRule,
} from "../../../../runtime/helpers/shaped-discovery";
