/** Commit message and agent settings. */

import { type DesktopSettings } from '../../../shared/settings.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection, Field } from '../fields.js';

export function AgentFeature({ m }: { m: SettingsModel }) {
  const {
    featureTab,
    draft,
    patch,
  } = m;

  return featureTab === 'agent' ? (
    <SettingsSection title="Commit messages & agent">
      <div className="field-grid">
        <Field id="commitStyle" label="Commit message style">
          <select
            id="commitStyle"
            value={draft.scm.commitMessageStyle}
            onChange={(e) =>
              patch({
                scm: {
                  commitMessageStyle: e.target
                    .value as DesktopSettings['scm']['commitMessageStyle'],
                },
              })
            }
          >
            <option value="conventional">Conventional</option>
            <option value="plain">Plain</option>
          </select>
        </Field>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.agent.taskListAutoAdvance}
          onChange={(e) =>
            patch({
              agent: { taskListAutoAdvance: e.target.checked },
            })
          }
        />
        Task list auto-advance
      </label>
      <Field id="engineImpl" label="Engine implementation">
        <select
          id="engineImpl"
          value={draft.agent.engineImplementation}
          onChange={(e) =>
            patch({
              agent: {
                engineImplementation: e.target.value as
                  | 'legacy'
                  | 'v8',
              },
            })
          }
        >
          <option value="v8">V8 (sole orchestrator)</option>
          <option value="legacy">Legacy (alias → v8)</option>
        </select>
      </Field>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.tools.applyPatch.fuzzyMatch}
          onChange={(e) =>
            patch({
              tools: {
                applyPatch: { fuzzyMatch: e.target.checked },
              },
            })
          }
        />
        Fuzzy match for apply_patch
      </label>
    </SettingsSection>
  ) : null;
}
