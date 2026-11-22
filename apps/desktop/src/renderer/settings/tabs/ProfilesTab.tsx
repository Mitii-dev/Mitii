/** Profiles tab (provider profile manager). */

import { ProfileSettings } from '../profiles/ProfileSettings.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';

export function ProfilesTab({ m }: { m: SettingsModel }) {
  const {
    tab,
    draft,
    patch,
    setDraft,
    props,
    saving,
  } = m;

  return tab === 'profiles' ? (
    <ProfileSettings
      draft={draft}
      patch={patch}
      setDraft={setDraft}
      engineBaseUrl={props.engineBaseUrl}
      authToken={props.authToken}
      hasApiKey={props.hasApiKey}
      busy={props.busy || saving}
      onProfilesChanged={props.onProfilesChanged}
      onPersistSettings={async (input) => {
        await props.onSave(input);
      }}
    />
  ) : null;
}
