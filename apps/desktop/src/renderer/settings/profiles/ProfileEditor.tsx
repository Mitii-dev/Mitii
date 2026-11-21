/** Focused profile editor. */

import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { ProviderFields } from './ProviderFields.js';
import { CredentialsFields } from './CredentialsFields.js';
import { ModelFields } from './ModelFields.js';
import { TokenLimitsSection } from './TokenLimitsSection.js';
import { ModesAndBudget } from './ModesAndBudget.js';
import { SettingsSection, Field } from './fields.js';

export function ProfileEditor({ m }: { m: ProfileSettingsModel }) {
  const {
    backToGallery,
    profileName,
    setProfileName,
    testing,
    props,
    runTest,
    testNote,
    saving,
    profiles,
    deleteProfile,
    saveProfile,
    note,
  } = m;

  return (
    <div className="settings-panel profile-settings">
      <div className="profile-editor">
        <div className="profile-editor__toolbar">
          <button
            type="button"
            className="btn btn-ghost"
            onClick={backToGallery}
          >
            ← All profiles
          </button>
          <span className="profile-editor__title">
            Edit · {profileName || 'Profile'}
          </span>
        </div>

        <SettingsSection title="Name">
          <Field id="editProfileName" label="Profile name" full>
            <input
              id="editProfileName"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
            />
          </Field>
        </SettingsSection>

        <SettingsSection
          title="Provider"
          description="Connection details for this profile."
        >
          <ProviderFields m={m} />
        </SettingsSection>

        <SettingsSection title="Credentials">
          <CredentialsFields m={m} />
          <div className="settings-actions">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={testing || !props.engineBaseUrl || props.busy}
              onClick={() => void runTest()}
            >
              {testing ? 'Testing…' : 'Test connection'}
            </button>
            {testNote ? <p className="field-help">{testNote}</p> : null}
          </div>
        </SettingsSection>

        <SettingsSection title="Model"><ModelFields m={m} /></SettingsSection>
        <TokenLimitsSection m={m} />
        <ModesAndBudget m={m} />

        <div className="profile-editor__footer">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving || profiles.length <= 1}
            onClick={() => void deleteProfile()}
          >
            Delete
          </button>
          <div className="profile-editor__footer-right">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={saving}
              onClick={backToGallery}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={saving || props.busy || !profileName.trim()}
              onClick={() => void saveProfile()}
            >
              {saving ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </div>
        {note ? <p className="field-help">{note}</p> : null}
      </div>
    </div>
  );
}
