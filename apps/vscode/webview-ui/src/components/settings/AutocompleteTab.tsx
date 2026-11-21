import { SettingsSection } from './shared';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';
import { type AutocompleteSettingsSnapshot } from '../../protocol';
import { NumberField } from '@mitii/ui-react';

export function AutocompleteTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    autocomplete,
    onAutocompleteChange,
    provider,
  } = props;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Inline Suggestions"
        description="Use a low-latency FIM endpoint for editor ghost text."
      >
        <label className="toggle-row">
          <input
            type="checkbox"
            checked={autocomplete.enabled}
            onChange={(event) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                enabled: event.target.checked,
              }))
            }
          />
          Enable autocomplete
        </label>
        <div className="field">
          <label htmlFor="autocomplete-provider">Provider</label>
          <select
            id="autocomplete-provider"
            value={autocomplete.provider}
            onChange={() =>
              onAutocompleteChange((prev) => ({
                ...prev,
                provider: 'openai-compatible',
              }))
            }
          >
            <option value="openai-compatible">
              OpenAI-compatible FIM
            </option>
          </select>
          <p className="field-hint">
            Uses the provider API key stored in SecretStorage.
          </p>
        </div>
        <div className="field">
          <label htmlFor="autocomplete-base-url">Base URL</label>
          <input
            id="autocomplete-base-url"
            value={autocomplete.baseUrl}
            placeholder={provider.baseUrl || 'inherit Provider base URL'}
            onChange={(event) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                baseUrl: event.target.value,
              }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="autocomplete-model">Model</label>
          <input
            id="autocomplete-model"
            value={autocomplete.model}
            placeholder={provider.model || 'inherit Provider model'}
            onChange={(event) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                model: event.target.value,
              }))
            }
          />
        </div>
        <div className="field">
          <label htmlFor="autocomplete-endpoint">Endpoint path</label>
          <input
            id="autocomplete-endpoint"
            value={autocomplete.endpointPath}
            placeholder="completions"
            onChange={(event) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                endpointPath: event.target.value,
              }))
            }
          />
          <p className="field-hint">
            Examples: completions, fim/completions.
          </p>
        </div>
        <div className="field">
          <label htmlFor="autocomplete-auth">Auth header</label>
          <select
            id="autocomplete-auth"
            value={autocomplete.authHeader}
            onChange={(event) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                authHeader: event.target
                  .value as AutocompleteSettingsSnapshot['authHeader'],
              }))
            }
          >
            <option value="authorization">Authorization Bearer</option>
            <option value="api-key">api-key</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Latency and Context"
        description="Bound each request so typing stays responsive."
      >
        <div className="settings-field-grid">
          <NumberField
            id="autocomplete-max-tokens"
            label="Max tokens"
            min={1}
            max={512}
            step={1}
            value={autocomplete.maxTokens}
            onCommit={(value) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                maxTokens: value,
              }))
            }
          />
          <NumberField
            id="autocomplete-debounce"
            label="Debounce"
            min={0}
            max={2000}
            step={25}
            value={autocomplete.debounceMs}
            onCommit={(value) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                debounceMs: value,
              }))
            }
          />
          <NumberField
            id="autocomplete-timeout"
            label="Timeout"
            min={250}
            max={30000}
            step={250}
            value={autocomplete.timeoutMs}
            onCommit={(value) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                timeoutMs: value,
              }))
            }
          />
          <NumberField
            id="autocomplete-prefix"
            label="Prefix chars"
            min={128}
            max={60000}
            step={128}
            value={autocomplete.prefixChars}
            onCommit={(value) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                prefixChars: value,
              }))
            }
          />
          <NumberField
            id="autocomplete-suffix"
            label="Suffix chars"
            min={0}
            max={60000}
            step={128}
            value={autocomplete.suffixChars}
            onCommit={(value) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                suffixChars: value,
              }))
            }
          />
          <NumberField
            id="autocomplete-temperature"
            label="Temperature"
            min={0}
            max={2}
            step={0.1}
            integer={false}
            value={autocomplete.temperature}
            onCommit={(value) =>
              onAutocompleteChange((prev) => ({
                ...prev,
                temperature: value,
              }))
            }
          />
        </div>
      </SettingsSection>
    </div>
  );
}
