/** Guided profile creation wizard. */

import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { ProviderFields } from './ProviderFields.js';
import { CredentialsFields } from './CredentialsFields.js';
import { ModelFields } from './ModelFields.js';
import { TokenLimitsSection } from './TokenLimitsSection.js';
import { ModesAndBudget } from './ModesAndBudget.js';
import { SettingsSection, Field } from './fields.js';
import { type CreateStep } from './types.js';

export function ProfileCreateWizard({ m }: { m: ProfileSettingsModel }) {
  const {
    createStep,
    profileName,
    setProfileName,
    testing,
    props,
    runTest,
    setConnectionOk,
    setTestNote,
    setCreateStep,
    testNote,
    connectionOk,
    saving,
    backToGallery,
    saveProfile,
    note,
  } = m;

  return (
    <div className="settings-panel profile-settings">
      <div className="profile-wizard">
        <div className="profile-wizard__steps" aria-label="Create steps">
          {(
            [
              [1, 'Provider'],
              [2, 'Name'],
              [3, 'Connect'],
              [4, 'Model'],
            ] as const
          ).map(([step, label]) => (
            <span
              key={step}
              className={`profile-wizard__step${createStep === step ? ' is-active' : ''}${createStep > step ? ' is-done' : ''}`}
            >
              <span className="profile-wizard__step-num">{step}</span>
              {label}
            </span>
          ))}
        </div>

        {createStep === 1 ? (
          <SettingsSection
            title="Choose a provider"
            description="Pick where this profile sends requests."
          >
            <ProviderFields m={m} />
          </SettingsSection>
        ) : null}

        {createStep === 2 ? (
          <SettingsSection
            title="Name this profile"
            description="You’ll switch profiles from the top bar."
          >
            <Field id="newProfileName" label="Profile name" full>
              <input
                id="newProfileName"
                autoFocus
                placeholder="e.g. Work · Ollama"
                value={profileName}
                onChange={(e) => setProfileName(e.target.value)}
              />
            </Field>
          </SettingsSection>
        ) : null}

        {createStep === 3 ? (
          <SettingsSection
            title="Connect"
            description="Add credentials if needed, then test before choosing a model."
          >
            <CredentialsFields m={m} />
            <div className="settings-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={testing || !props.engineBaseUrl || props.busy}
                onClick={() => void runTest()}
              >
                {testing ? 'Testing…' : 'Test connection'}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={testing}
                onClick={() => {
                  setConnectionOk(true);
                  setTestNote('Skipped — you can still pick a model next.');
                  setCreateStep(4);
                }}
              >
                Skip for now
              </button>
              {testNote ? (
                <p
                  className={`field-help${connectionOk ? '' : ' danger-text'}`}
                >
                  {testNote}
                </p>
              ) : null}
            </div>
          </SettingsSection>
        ) : null}

        {createStep === 4 ? (
          <>
            <SettingsSection
              title="Model"
              description="Pick a model from discovery or type one manually."
            >
              <ModelFields m={m} />
            </SettingsSection>
            <TokenLimitsSection m={m} />
            <ModesAndBudget m={m} />
          </>
        ) : null}

        <div className="profile-editor__footer">
          <button
            type="button"
            className="btn btn-ghost"
            disabled={saving}
            onClick={() => {
              if (createStep === 1) backToGallery();
              else setCreateStep((s) => (s - 1) as CreateStep);
            }}
          >
            {createStep === 1 ? 'Cancel' : 'Back'}
          </button>
          <div className="profile-editor__footer-right">
            {createStep < 4 ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={
                  (createStep === 2 && !profileName.trim()) ||
                  (createStep === 3 &&
                    !connectionOk &&
                    props.draft.provider.type !== 'echo')
                }
                onClick={() => {
                  if (createStep === 3 && props.draft.provider.type === 'echo') {
                    setConnectionOk(true);
                  }
                  setCreateStep((s) => (s + 1) as CreateStep);
                }}
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving || props.busy || !profileName.trim()}
                onClick={() => void saveProfile()}
              >
                {saving ? 'Saving…' : 'Create profile'}
              </button>
            )}
          </div>
        </div>
        {createStep === 3 &&
        !connectionOk &&
        props.draft.provider.type !== 'echo' ? (
          <p className="field-help">
            Test connection successfully to continue — or use Echo for a local
            stub.
          </p>
        ) : null}
        {note ? <p className="field-help">{note}</p> : null}
      </div>
    </div>
  );
}
