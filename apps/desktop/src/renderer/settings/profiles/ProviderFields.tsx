/** Provider preset and endpoint fields. */

import { PROVIDER_PRESET_OPTIONS } from '../../../shared/settings.js';
import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { Field } from './fields.js';

export function ProviderFields({ m }: { m: ProfileSettingsModel }) {
  const {
    props,
    onPreset,
    presetMeta,
    setConnectionOk,
  } = m;

  return (
    <>
      <div className="field-grid">
        <Field id="preset" label="Provider">
          <select
            id="preset"
            value={props.draft.provider.preset}
            onChange={(e) => onPreset(e.target.value)}
          >
            {PROVIDER_PRESET_OPTIONS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
        </Field>
        <Field id="type" label="Adapter">
          <input id="type" value={presetMeta.type} readOnly />
        </Field>
        {props.draft.provider.type !== 'echo' ? (
          <Field
            id="baseUrl"
            label="Base URL"
            full
            hint={
              props.draft.provider.type === 'anthropic' ||
              props.draft.provider.type === 'gemini'
                ? 'Override only for a proxy or regional endpoint.'
                : 'Local hosts often do not need an API key.'
            }
          >
            <input
              id="baseUrl"
              placeholder={presetMeta.baseUrl || 'https://…'}
              value={props.draft.provider.baseUrl}
              onChange={(e) => {
                setConnectionOk(false);
                props.patch({
                  provider: {
                    ...props.draft.provider,
                    baseUrl: e.target.value,
                  },
                });
              }}
            />
          </Field>
        ) : null}
      </div>
    </>
  );
}
