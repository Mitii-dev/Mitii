/**
 * Profiles settings — gallery tiles + guided create + focused edit.
 */

import { ProfileCreateWizard } from './ProfileCreateWizard.js';
import { ProfileEditor } from './ProfileEditor.js';
import { ProfileGallery } from './ProfileGallery.js';
import type { ProfileSettingsProps } from './types.js';
import { useProfileSettingsModel } from './useProfileSettingsModel.js';

export type { ProfileSettingsProps } from './types.js';

export function ProfileSettings(props: ProfileSettingsProps) {
  const model = useProfileSettingsModel(props);
  if (model.view === 'gallery') return <ProfileGallery m={model} />;
  if (model.view === 'create') return <ProfileCreateWizard m={model} />;
  return <ProfileEditor m={model} />;
}
