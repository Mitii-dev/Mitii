/** Web search settings. */

import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection, Field } from '../fields.js';

export function SearchFeature({ m }: { m: SettingsModel }) {
  const {
    featureTab,
    draft,
    patch,
    props,
    searchApiKey,
    clearSearchApiKey,
    setSearchApiKey,
    setClearSearchApiKey,
  } = m;

  return featureTab === 'search' ? (
    <SettingsSection
      title="Web search"
      description="SearXNG preferred; optional Brave key for fallback."
    >
      <div className="field-grid">
        <Field
          id="featSearx"
          label="SearXNG base URL"
          full
          hint="Base URL only (no /search). Instance must allow JSON."
        >
          <input
            id="featSearx"
            placeholder="http://127.0.0.1:8080"
            value={draft.search.searxngBaseUrl}
            onChange={(e) =>
              patch({ search: { searxngBaseUrl: e.target.value } })
            }
          />
        </Field>
        <Field
          id="featSearchKey"
          label={`Web search API key${props.hasSearchApiKey ? ' (saved)' : ''}`}
          full
        >
          <input
            id="featSearchKey"
            type="password"
            autoComplete="off"
            placeholder={
              props.hasSearchApiKey
                ? '••••••••  (unchanged)'
                : 'Optional Brave / search key'
            }
            value={searchApiKey}
            disabled={clearSearchApiKey}
            onChange={(e) => setSearchApiKey(e.target.value)}
          />
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={clearSearchApiKey}
              onChange={(e) =>
                setClearSearchApiKey(e.target.checked)
              }
            />
            Clear saved search API key
          </label>
        </Field>
      </div>
    </SettingsSection>
  ) : null;
}
