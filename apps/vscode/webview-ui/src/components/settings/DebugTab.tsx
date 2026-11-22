import { LoopPolicyEditor } from '../LoopPolicyEditor';
import { TokenBudgetFieldHelp } from '../TokenBudgetFieldHelp';
import { formatIndexMode } from './indexLabels';
import { SettingsSection, KeyValueList } from './shared';
import { TokenBudgetPreviewTable } from './tokenBudgetViews';
import { type SettingsPanelProps } from './types';
import { type SettingsPanelView } from './useSettingsPanelState';
import { getProviderPreset } from '../../providerOptions';
import { TokenBudgetEditor } from '@mitii/ui-react';

export function DebugTab({ props, view }: { props: SettingsPanelProps; view: SettingsPanelView }) {
  const {
    index,
    mcpRuntimeStatus,
    onResetLoopPolicy,
    onResetTokenBudget,
    onResetV8LoopPolicy,
    onSaveUi,
    provider,
    ui,
    workspace,
  } = props;

  const {
    autoMaxOutput,
    livePreview,
    storedMaxOutput,
  } = view;

  return (
    <div className="settings-panel">
      <SettingsSection
        title="Access"
        description="Unlocks logging and local Custom token / loop editors. Ship defaults: pnpm policy-admin."
      >
        <label className="toggle">
          <input
            type="checkbox"
            checked={ui.developerEnabled}
            onChange={(e) =>
              onSaveUi({ developerEnabled: e.target.checked })
            }
          />
          Enable developer settings
        </label>
      </SettingsSection>

      <SettingsSection
        title="Logging"
        description="Verbose stacks and optional model request/response dumps."
      >
        <div
          className={`developer-options${
            ui.developerEnabled ? '' : ' is-locked'
          }`}
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.debugLogging}
              disabled={!ui.developerEnabled}
              onChange={(e) =>
                onSaveUi({ debugLogging: e.target.checked })
              }
            />
            Debug logging
          </label>
          <p className="field-hint">
            When on, Mitii shows the Output channel and prints verbose
            stacks on failures (
            <span className="mono">mitii.debug</span>).
          </p>
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.modelIoLogging === true}
              disabled={!ui.developerEnabled}
              onChange={(e) =>
                onSaveUi({ modelIoLogging: e.target.checked })
              }
            />
            Log model I/O
          </label>
          <p className="field-hint">
            Writes sanitized messages in / assistant out to a separate{' '}
            <span className="mono">*-model-io.jsonl</span> under{' '}
            <span className="mono">.mitii/logs/</span> (
            <span className="mono">mitii.developer.modelIo</span>). Keep
            local — may include workspace content. Use command{' '}
            <span className="mono">Mitii: Export Shareable Diagnostic</span>{' '}
            for a redacted one-file paste for online help.
          </p>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Token budget (local)"
        description="Optional local overrides for this machine. Shares need not total 100% — leftover shows as Free. Permanent ship defaults: pnpm policy-admin."
      >
        <div
          className={`developer-options${
            ui.developerEnabled ? '' : ' is-locked'
          }`}
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.tokenBudget.enabled}
              disabled={!ui.developerEnabled}
              onChange={(e) =>
                onSaveUi({
                  tokenBudget: { enabled: e.target.checked },
                })
              }
            />
            Custom token budget
          </label>
          <p className="field-hint">
            {ui.tokenBudget.enabled
              ? 'Custom values stay put when the window changes. Reset to follow the window again.'
              : 'Leave off to follow the context window. Moving a Simple slider turns this on.'}
          </p>
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={onResetTokenBudget}
              disabled={!ui.developerEnabled}
            >
              Reset budgets to defaults
            </button>
          </div>
          <TokenBudgetEditor
            fields={ui.tokenBudget.fields}
            renderFieldHelp={(field, value) => (
              <TokenBudgetFieldHelp
                field={field}
                value={value}
                preview={livePreview}
              />
            )}
            policy={ui.tokenBudget.policy}
            preview={livePreview}
            customEnabled={ui.tokenBudget.enabled}
            outputOverride={!autoMaxOutput && storedMaxOutput > 0}
            disabled={!ui.developerEnabled}
            onPolicyChange={(patch) =>
              onSaveUi({
                tokenBudget: { enabled: true, policy: patch },
              })
            }
          />
          <details className="settings-advanced">
            <summary>Derived counts</summary>
            <TokenBudgetPreviewTable preview={livePreview} />
          </details>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Loop / stall (local)"
        description={`Active band: ${ui.loopPolicy.band.label} (${ui.loopPolicy.band.rangeLabel}). Local Custom only — ship bands via pnpm policy-admin.`}
      >
        <div
          className={`developer-options${
            ui.developerEnabled ? '' : ' is-locked'
          }`}
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.loopPolicy.enabled}
              disabled={!ui.developerEnabled}
              onChange={(e) =>
                onSaveUi({
                  loopPolicy: { enabled: e.target.checked },
                })
              }
            />
            Custom loop policy
          </label>
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={onResetLoopPolicy}
              disabled={!ui.developerEnabled}
            >
              Reset to ship band
            </button>
          </div>
          {ui.loopPolicy.enabled ? (
            <LoopPolicyEditor
              fields={ui.loopPolicy.fields}
              thresholds={ui.loopPolicy.thresholds}
              bandThresholds={ui.loopPolicy.bandThresholds}
              customEnabled={ui.loopPolicy.enabled}
              disabled={!ui.developerEnabled}
              onThresholdsChange={(patch) =>
                onSaveUi({
                  loopPolicy: { enabled: true, thresholds: patch },
                })
              }
            />
          ) : (
            <p className="field-hint">
              Using shipped {ui.loopPolicy.band.label} band. Turn Custom
              on only to lab-test local deltas.
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="V8 engine knobs (local)"
        description={`Active band: ${ui.v8LoopPolicy.band.label} (${ui.v8LoopPolicy.band.rangeLabel}). Applies when mitii.engine.implementation is v8. Ship via pnpm policy-admin §4.`}
      >
        <div
          className={`developer-options${
            ui.developerEnabled ? '' : ' is-locked'
          }`}
        >
          <label className="toggle">
            <input
              type="checkbox"
              checked={ui.v8LoopPolicy.enabled}
              disabled={!ui.developerEnabled}
              onChange={(e) =>
                onSaveUi({
                  v8LoopPolicy: { enabled: e.target.checked },
                })
              }
            />
            Custom v8 loop policy
          </label>
          <div className="row">
            <button
              type="button"
              className="btn ghost"
              onClick={onResetV8LoopPolicy}
              disabled={!ui.developerEnabled}
            >
              Reset to ship band
            </button>
          </div>
          {ui.v8LoopPolicy.enabled ? (
            <LoopPolicyEditor
              idPrefix="v8LoopPolicy"
              fields={ui.v8LoopPolicy.fields}
              thresholds={ui.v8LoopPolicy.thresholds}
              bandThresholds={ui.v8LoopPolicy.bandThresholds}
              customEnabled={ui.v8LoopPolicy.enabled}
              disabled={!ui.developerEnabled}
              onThresholdsChange={(patch) =>
                onSaveUi({
                  v8LoopPolicy: { enabled: true, thresholds: patch },
                })
              }
            />
          ) : (
            <p className="field-hint">
              Using shipped {ui.v8LoopPolicy.band.label} v8 band. Turn
              Custom on only to lab-test local deltas.
            </p>
          )}
        </div>
      </SettingsSection>

      <SettingsSection
        title="Diagnostics"
        description="Use View → Output → Mitii for activation and run logs. Ship policy: pnpm policy-admin."
      >
        <KeyValueList
          rows={[
            {
              label: 'Provider',
              value:
                provider.connectionStatus ??
                (provider.connectionOk === true
                  ? 'OK'
                  : provider.connectionOk === false
                    ? 'Failed'
                    : 'Not tested'),
            },
            { label: 'MCP runtime', value: mcpRuntimeStatus },
            {
              label: 'Index token',
              value: index.stateTokenPreview ?? '—',
            },
            {
              label: 'Index mode',
              value: `${formatIndexMode(index.indexMode)} · files=${index.fileCount}`,
            },
            {
              label: 'Preset',
              value:
                getProviderPreset(provider.preset ?? provider.type)
                  ?.label ?? provider.type,
            },
            {
              label: 'Policy band',
              value: `${ui.loopPolicy.band.label} (${ui.loopPolicy.band.rangeLabel})`,
            },
          ]}
        />
      </SettingsSection>
    </div>
  );
}
