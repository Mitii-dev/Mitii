/** Working-tree review settings. */

import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection } from '../fields.js';

export function ReviewFeature({ m }: { m: SettingsModel }) {
  const {
    featureTab,
    draft,
    patch,
  } = m;

  return featureTab === 'review' ? (
    <SettingsSection
      title="Working-tree review"
      description="Code Review runs an LLM analysis of git changes."
    >
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={draft.ui.features.codeReviewButton}
          onChange={(e) =>
            patch({
              ui: {
                ...draft.ui,
                features: { codeReviewButton: e.target.checked },
              },
            })
          }
        />
        Show Code Review button
      </label>
    </SettingsSection>
  ) : null;
}
