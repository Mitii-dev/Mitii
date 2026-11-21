import { IconAgent, IconAsk, IconPlan } from '../Icons';
import { SettingsSection } from './shared';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';
import { NumberField } from '@mitii/ui-react';

export function ModesTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    onSaveUi,
    ui,
  } = props;

  const {
    modeDefault,
    modeSettingsTab,
    options,
    setModeSettingsTab,
  } = view;

  return (
    <div className="settings-panel">
      <SettingsSection title="Mode defaults">
        <div
          className="mode-settings-tabs"
          role="tablist"
          aria-label="Mode settings"
        >
          {[
            { id: 'ask' as const, label: 'Ask', icon: <IconAsk /> },
            { id: 'plan' as const, label: 'Plan', icon: <IconPlan /> },
            {
              id: 'agent' as const,
              label: 'Agent',
              icon: <IconAgent />,
            },
          ].map((modeTab) => (
            <button
              key={modeTab.id}
              type="button"
              role="tab"
              aria-selected={modeSettingsTab === modeTab.id}
              className={`mode-settings-tab${
                modeSettingsTab === modeTab.id ? ' is-active' : ''
              }`}
              onClick={() => setModeSettingsTab(modeTab.id)}
            >
              <span className="mode-settings-tab__icon">
                {modeTab.icon}
              </span>
              <span>{modeTab.label}</span>
            </button>
          ))}
        </div>
        <p className="mode-settings-summary">
          {modeSettingsTab === 'ask'
            ? 'Ask stays lightweight: read, explain, and answer with minimal workspace impact.'
            : modeSettingsTab === 'plan'
              ? 'Plan focuses on structure: clarify scope, draft phases, and save a handoff-ready plan.'
              : 'Agent is execution-focused: use tools, edit files, and stop at approval and budget limits.'}
        </p>
        <div className="field">
          <label htmlFor="approval">Approval mode</label>
          <select
            id="approval"
            value={
              modeDefault.approvalMode === 'builder'
                ? 'guided'
                : modeDefault.approvalMode
            }
            onChange={(e) =>
              onSaveUi({
                modeDefaults: {
                  [modeSettingsTab]: { approvalMode: e.target.value },
                },
              })
            }
          >
            <option value="safe">Ask for approval</option>
            <option value="guided">Approve for me</option>
            <option value="pilot">Full access</option>
          </select>
        </div>
        <div className="field">
          <label htmlFor="modeModel">Default model</label>
          <select
            id="modeModel"
            value={modeDefault.model ?? ''}
            onChange={(e) =>
              onSaveUi({
                modeDefaults: {
                  [modeSettingsTab]: { model: e.target.value },
                },
              })
            }
          >
            <option value="">Use active model</option>
            {options.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={ui.showReasoning}
            onChange={(e) =>
              onSaveUi({ showReasoning: e.target.checked })
            }
          />
          Show reasoning stream
        </label>
        <NumberField
          id="preview"
          label="Reasoning preview chars"
          min={500}
          max={50000}
          value={ui.reasoningPreviewMaxChars}
          onCommit={(value) =>
            onSaveUi({
              reasoningPreviewMaxChars: value,
            })
          }
        />
        <p className="field-hint">
          Thoroughness stays on the composer. Ship loop / window defaults
          live in <code>pnpm policy-admin</code>.
        </p>
      </SettingsSection>
      <SettingsSection
        title="Run budget"
        description="Optional safety caps for one turn. You do not need to retune these when you change the context window."
      >
        <label className="toggle">
          <input
            type="checkbox"
            checked={ui.runBudget.unlimited}
            onChange={(e) =>
              onSaveUi({
                runBudget: { unlimited: e.target.checked },
              })
            }
          />
          Unlimited run budget
        </label>
        <div className="settings-field-grid">
          <NumberField
            id="maxModelCalls"
            label="Model calls"
            min={1}
            disabled={ui.runBudget.unlimited}
            value={ui.runBudget.maxModelCalls}
            onCommit={(value) =>
              onSaveUi({
                runBudget: { maxModelCalls: value },
              })
            }
          />
          <NumberField
            id="maxToolCalls"
            label="Tool calls"
            min={1}
            disabled={ui.runBudget.unlimited}
            value={ui.runBudget.maxToolCalls}
            onCommit={(value) =>
              onSaveUi({
                runBudget: { maxToolCalls: value },
              })
            }
          />
          <NumberField
            id="maxLoopIterations"
            label="Loop iterations"
            min={1}
            disabled={ui.runBudget.unlimited}
            value={ui.runBudget.maxLoopIterations}
            onCommit={(value) =>
              onSaveUi({
                runBudget: { maxLoopIterations: value },
              })
            }
          />
          <NumberField
            id="maxWallTimeMinutes"
            label="Wall time (min)"
            min={1}
            disabled={ui.runBudget.unlimited}
            value={ui.runBudget.maxWallTimeMinutes}
            onCommit={(value) =>
              onSaveUi({
                runBudget: { maxWallTimeMinutes: value },
              })
            }
          />
        </div>
      </SettingsSection>
    </div>
  );
}
