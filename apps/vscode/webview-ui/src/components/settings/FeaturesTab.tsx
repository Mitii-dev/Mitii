import { SettingsSection } from './shared';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';

export function FeaturesTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    onSaveUi,
    ui,
  } = props;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Working-tree review"
        description="Review opens your git changes. Code Review runs an LLM analysis of those changes."
      >
        <label className="toggle">
          <input
            type="checkbox"
            checked={ui.features.codeReviewButton === true}
            onChange={(e) =>
              onSaveUi({
                features: { codeReviewButton: e.target.checked },
              })
            }
          />
          Show Code Review button
        </label>
        <p className="field-hint">
          <strong>Review</strong> always lists staged/unstaged files.
          Enable this to also show <strong>Code Review</strong>, which
          runs the code-review skill over those changes. Off by default.
        </p>
      </SettingsSection>
    </div>
  );
}
