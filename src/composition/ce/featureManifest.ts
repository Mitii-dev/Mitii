import type { FeatureModule } from '../../interfaces/feature';
import { ceFeatureModules } from '../../features/ce/featureModules';
import { vscodeHostFeature } from './vscodeHostFeature';

export const ceFeatures: readonly FeatureModule[] = [...ceFeatureModules, vscodeHostFeature];
