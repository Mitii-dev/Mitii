/** Inline completion (locked) settings. */

import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection, Field } from '../fields.js';

export function AutocompleteFeature({ m }: { m: SettingsModel }) {
  const {
    featureTab,
    draft,
  } = m;

  return featureTab === 'autocomplete' ? (
    <SettingsSection
      title="Inline completion"
      description="Desktop FIM / next-edit is not available yet. Settings are locked so nothing is silently half-enabled."
    >
      <p className="settings-lock-banner" role="status">
        Coming soon — inline autocomplete is disabled in Desktop.
        Use the VS Code extension for FIM today.
      </p>
      <div className="developer-options is-locked">
        <label className="checkbox-row">
          <input type="checkbox" checked={false} disabled />
          Enable autocomplete
        </label>
        <div className="field-grid">
          <Field id="acMode" label="Mode">
            <input
              id="acMode"
              value={draft.autocomplete.mode}
              readOnly
              disabled
            />
          </Field>
          <Field
            id="acProvider"
            label="Provider"
            hint="Locked until Desktop FIM ships"
          >
            <input
              id="acProvider"
              value={draft.autocomplete.provider}
              readOnly
              disabled
            />
          </Field>
          <Field
            id="acBase"
            label="Base URL"
            full
            hint="Empty inherits Provider base URL"
          >
            <input
              id="acBase"
              value={draft.autocomplete.baseUrl}
              placeholder={draft.provider.baseUrl || 'inherit'}
              disabled
              readOnly
            />
          </Field>
          <Field id="acModel" label="Model">
            <input
              id="acModel"
              value={draft.autocomplete.model}
              placeholder={draft.provider.model || 'inherit'}
              disabled
              readOnly
            />
          </Field>
        </div>
      </div>
    </SettingsSection>
  ) : null;
}
