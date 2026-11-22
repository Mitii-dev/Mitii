/** API key credential fields. */

import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { Field } from './fields.js';

export function CredentialsFields({ m }: { m: ProfileSettingsModel }) {
  const {
    props,
    apiKey,
    clearApiKey,
    setConnectionOk,
    setApiKey,
    setClearApiKey,
  } = m;

  return (
    <div className="field-grid">
      <Field
        id="apiKey"
        label={`API key${props.hasApiKey ? ' (saved — leave blank to keep)' : ''}`}
        full
      >
        <input
          id="apiKey"
          type="password"
          autoComplete="off"
          placeholder={props.hasApiKey ? '••••••••  (unchanged)' : 'Optional'}
          value={apiKey}
          disabled={clearApiKey}
          onChange={(e) => {
            setConnectionOk(false);
            setApiKey(e.target.value);
          }}
        />
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={clearApiKey}
            onChange={(e) => setClearApiKey(e.target.checked)}
          />
          Clear saved API key
        </label>
      </Field>
    </div>
  );
}
