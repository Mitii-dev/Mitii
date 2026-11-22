/** Model picker fields. */

import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { Field } from './fields.js';

export function ModelFields({ m }: { m: ProfileSettingsModel }) {
  const {
    props,
    models,
  } = m;

  return (
    <>
      <div className="field-grid">
        <Field id="model" label="Model" full>
          <input
            id="model"
            placeholder="qwen3-coder:30b"
            value={props.draft.provider.model}
            onChange={(e) =>
              props.patch({
                provider: { ...props.draft.provider, model: e.target.value },
              })
            }
          />
        </Field>
        {models.length > 0 ? (
          <Field id="discoveredModels" label="Discovered models" full>
            <select
              id="discoveredModels"
              value={
                models.includes(props.draft.provider.model)
                  ? props.draft.provider.model
                  : ''
              }
              onChange={(e) =>
                props.patch({
                  provider: {
                    ...props.draft.provider,
                    model: e.target.value,
                  },
                })
              }
            >
              <option value="">Choose a model…</option>
              {models.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
        ) : null}
      </div>
    </>
  );
}
