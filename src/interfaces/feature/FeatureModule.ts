import type { FeatureRegistrationContext } from './FeatureContext';
import type { FeatureManifest } from './FeatureManifest';

export interface FeatureModule {
  readonly manifest: FeatureManifest;
  register(context: FeatureRegistrationContext): void;
}
