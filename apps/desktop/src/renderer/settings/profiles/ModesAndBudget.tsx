/** Per-mode defaults and token budget allocation. */

import { type DesktopSettings } from '../../../shared/settings.js';
import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { SettingsSection, Field } from './fields.js';

export function ModesAndBudget({ m }: { m: ProfileSettingsModel }) {
  const {
    modeTab,
    setModeTab,
    modeDefault,
    props,
    models,
  } = m;

  return (
    <>
      <SettingsSection
        title="Mode defaults"
        description="Ask, Plan, and Agent defaults for this profile’s workspace settings."
      >
        <div className="mode-settings-tabs" role="tablist">
          {(['ask', 'plan', 'agent'] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={modeTab === m}
              className={`mode-settings-tab${modeTab === m ? ' is-active' : ''}`}
              onClick={() => setModeTab(m)}
            >
              {m[0]!.toUpperCase() + m.slice(1)}
            </button>
          ))}
        </div>
        <div className="field-grid">
          <Field id="approval" label="Approval mode">
            <select
              id="approval"
              value={
                modeDefault.approvalMode === 'builder'
                  ? 'guided'
                  : modeDefault.approvalMode
              }
              onChange={(e) => {
                const approvalMode = e.target
                  .value as DesktopSettings['ui']['modeDefaults']['ask']['approvalMode'];
                props.patch({
                  ui: {
                    ...props.draft.ui,
                    modeDefaults: {
                      ...props.draft.ui.modeDefaults,
                      [modeTab]: { ...modeDefault, approvalMode },
                    },
                  },
                  safety: {
                    ...props.draft.safety,
                    approvalMode:
                      modeTab === 'agent'
                        ? approvalMode
                        : props.draft.safety.approvalMode,
                  },
                });
              }}
            >
              <option value="safe">Ask for approval</option>
              <option value="guided">Approve for me</option>
              <option value="pilot">Full access</option>
              <option value="auto">Auto</option>
            </select>
          </Field>
          <Field id="thoroughness" label="Thoroughness">
            <select
              id="thoroughness"
              value={
                modeDefault.thoroughness === 'quick'
                  ? 'low'
                  : modeDefault.thoroughness === 'thorough'
                    ? 'high'
                    : modeDefault.thoroughness === 'low' ||
                        modeDefault.thoroughness === 'medium' ||
                        modeDefault.thoroughness === 'high'
                      ? modeDefault.thoroughness
                      : 'medium'
              }
              onChange={(e) =>
                props.patch({
                  ui: {
                    ...props.draft.ui,
                    modeDefaults: {
                      ...props.draft.ui.modeDefaults,
                      [modeTab]: {
                        ...modeDefault,
                        thoroughness: e.target
                          .value as typeof modeDefault.thoroughness,
                      },
                    },
                  },
                })
              }
            >
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
            </select>
          </Field>
          <Field
            id="modeModel"
            label="Default model"
            full
            hint="Empty keeps the active chat model. Changing Ask/Plan/Agent in the composer switches to this model when set."
          >
            <select
              id="modeModel"
              value={modeDefault.model ?? ''}
              onChange={(e) =>
                props.patch({
                  ui: {
                    ...props.draft.ui,
                    modeDefaults: {
                      ...props.draft.ui.modeDefaults,
                      [modeTab]: {
                        ...modeDefault,
                        model: e.target.value,
                      },
                    },
                  },
                })
              }
            >
              <option value="">Use active model</option>
              {Array.from(
                new Set(
                  [
                    props.draft.provider.model,
                    modeDefault.model,
                    ...models,
                  ]
                    .map((id) => id?.trim())
                    .filter((id): id is string => Boolean(id)),
                ),
              ).map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </Field>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Run budget"
        description="Optional safety caps for one turn."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={props.draft.runBudget.unlimited}
            onChange={(e) =>
              props.patch({
                runBudget: {
                  ...props.draft.runBudget,
                  unlimited: e.target.checked,
                },
              })
            }
          />
          Unlimited run budget
        </label>
        <div className="field-grid">
          <Field id="maxModelCalls" label="Model calls">
            <input
              id="maxModelCalls"
              type="number"
              min={1}
              disabled={props.draft.runBudget.unlimited}
              value={props.draft.runBudget.maxModelCalls}
              onChange={(e) =>
                props.patch({
                  runBudget: {
                    ...props.draft.runBudget,
                    maxModelCalls: Number(e.target.value) || 1,
                  },
                })
              }
            />
          </Field>
          <Field id="maxToolCalls" label="Tool calls">
            <input
              id="maxToolCalls"
              type="number"
              min={1}
              disabled={props.draft.runBudget.unlimited}
              value={props.draft.runBudget.maxToolCalls}
              onChange={(e) =>
                props.patch({
                  runBudget: {
                    ...props.draft.runBudget,
                    maxToolCalls: Number(e.target.value) || 1,
                  },
                })
              }
            />
          </Field>
        </div>
      </SettingsSection>
    </>
  );
}
