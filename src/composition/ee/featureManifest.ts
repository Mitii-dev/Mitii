import type { FeatureModule } from '../../interfaces/feature';
import { eeFeatureModules } from '../../features/ee/featureModules';
import { ceFeatures } from '../ce/featureManifest';

export const eeFeatures: readonly FeatureModule[] = eeFeatureModules;

export const allEnterpriseFeatures: readonly FeatureModule[] = [
  ...ceFeatures,
  ...eeFeatures,
];
