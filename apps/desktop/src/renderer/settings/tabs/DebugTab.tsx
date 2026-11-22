/** Developer / debug tab. */

import { type DesktopSettings } from '../../../shared/settings.js';
import { TokenBudgetEditor } from '@mitii/ui-react';
import { deriveLiveTokenBudgetPreview, isAutoMaximumOutputTokens } from '@mitii/ui-core';
import { LoopPolicyEditor } from '../LoopPolicyEditor.js';
import {
  openLatestSessionLog,
  getDesktopBridge,
  exportSessionLog,
  exportShareableDiagnostic,
  exportAuditPack,
} from '../../api.js';
import type { SettingsModel } from '../useSettingsPanelModel.js';
import { SettingsSection, Field } from '../fields.js';
import {
  catalogNumberDescriptors,
  numericPolicyRecord,
  policyBaselineNumbers,
} from '../policyCatalog.js';

export function DebugTab({ m }: { m: SettingsModel }) {
  const {
    tab,
    draft,
    patch,
    setDraft,
    props,
    setNote,
  } = m;

  return tab === 'debug' ? (
    <div className="settings-panel">
      <SettingsSection
        title="Access"
        description="Unlocks logging and local token / loop editors."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={draft.developer.enabled}
            onChange={(e) =>
              patch({
                developer: {
                  ...draft.developer,
                  enabled: e.target.checked,
                },
              })
            }
          />
          Enable developer settings
        </label>
      </SettingsSection>
  
      <SettingsSection title="Logging">
        <div
          className={`developer-options${draft.developer.enabled ? '' : ' is-locked'}`}
        >
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={!draft.developer.enabled}
              checked={draft.debug}
              onChange={(e) => patch({ debug: e.target.checked })}
            />
            Debug logging
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={!draft.developer.enabled}
              checked={draft.developer.modelIo}
              onChange={(e) =>
                patch({
                  developer: {
                    ...draft.developer,
                    modelIo: e.target.checked,
                  },
                })
              }
            />
            Model I/O dumps
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={!draft.developer.enabled}
              checked={draft.developer.intensityOverrides}
              onChange={(e) =>
                patch({
                  developer: {
                    ...draft.developer,
                    intensityOverrides: e.target.checked,
                  },
                })
              }
            />
            Intensity overrides (depth / effort separate)
          </label>
          <div className="field-grid">
            <Field id="logVerbosity" label="Log verbosity">
              <select
                id="logVerbosity"
                disabled={!draft.developer.enabled}
                value={draft.logVerbosity}
                onChange={(e) =>
                  patch({
                    logVerbosity: e.target
                      .value as DesktopSettings['logVerbosity'],
                  })
                }
              >
                <option value="minimal">Minimal</option>
                <option value="standard">Standard</option>
                <option value="verbose">Verbose</option>
              </select>
            </Field>
          </div>
        </div>
      </SettingsSection>
  
      <SettingsSection
        title="Token budget"
        description="All mitii.tokenBudget.* keys. Requires developer access."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={!draft.developer.enabled}
            checked={draft.tokenBudget.enabled}
            onChange={(e) =>
              patch({
                tokenBudget: {
                  ...draft.tokenBudget,
                  enabled: e.target.checked,
                },
              })
            }
          />
          Enable custom token-budget overrides
        </label>
        <TokenBudgetEditor
          hintMode="inline"
          fields={catalogNumberDescriptors('tokenBudget')}
          policy={numericPolicyRecord(
            draft.tokenBudget as unknown as Record<string, unknown>,
          )}
          preview={deriveLiveTokenBudgetPreview({
            contextWindowTokens:
              draft.provider.contextWindow > 0
                ? draft.provider.contextWindow
                : 128_000,
            maximumOutputTokens: draft.provider.maximumOutputTokens,
            policy: draft.tokenBudget.enabled
              ? numericPolicyRecord(
                  draft.tokenBudget as unknown as Record<string, unknown>,
                )
              : undefined,
            runBudget: draft.runBudget,
          })}
          customEnabled={draft.tokenBudget.enabled}
          outputOverride={
            !isAutoMaximumOutputTokens(draft.provider.maximumOutputTokens)
          }
          disabled={
            !draft.developer.enabled || !draft.tokenBudget.enabled
          }
          onPolicyChange={(policyPatch) =>
            setDraft((prev) => ({
              ...prev,
              tokenBudget: {
                ...prev.tokenBudget,
                enabled: true,
                ...policyPatch,
              },
            }))
          }
        />
      </SettingsSection>
  
      <SettingsSection
        title="Loop policy"
        description="All mitii.loopPolicy.* keys."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={!draft.developer.enabled}
            checked={draft.loopPolicy.enabled}
            onChange={(e) =>
              patch({
                loopPolicy: {
                  ...draft.loopPolicy,
                  enabled: e.target.checked,
                },
              })
            }
          />
          Enable loop policy overrides
        </label>
        <LoopPolicyEditor
          fields={catalogNumberDescriptors('loopPolicy')}
          thresholds={numericPolicyRecord(
            draft.loopPolicy as unknown as Record<string, unknown>,
          )}
          bandThresholds={policyBaselineNumbers('loopPolicy')}
          customEnabled={draft.loopPolicy.enabled}
          disabled={
            !draft.developer.enabled || !draft.loopPolicy.enabled
          }
          onThresholdsChange={(thresholdsPatch) =>
            setDraft((prev) => ({
              ...prev,
              loopPolicy: {
                ...prev.loopPolicy,
                enabled: true,
                ...thresholdsPatch,
              },
            }))
          }
        />
      </SettingsSection>
  
      <SettingsSection
        title="V8 engine knobs"
        description="All mitii.v8LoopPolicy.* keys. Forwarded to runs when enabled (V8 engine only); the engine applies these overrides on top of its ship thresholds."
      >
        <label className="checkbox-row">
          <input
            type="checkbox"
            disabled={!draft.developer.enabled}
            checked={draft.v8LoopPolicy.enabled}
            onChange={(e) =>
              patch({
                v8LoopPolicy: {
                  ...draft.v8LoopPolicy,
                  enabled: e.target.checked,
                },
              })
            }
          />
          Enable v8 loop policy overrides
        </label>
        <LoopPolicyEditor
          idPrefix="v8LoopPolicy"
          fields={catalogNumberDescriptors('v8LoopPolicy')}
          thresholds={numericPolicyRecord(
            draft.v8LoopPolicy as unknown as Record<string, unknown>,
          )}
          bandThresholds={policyBaselineNumbers('v8LoopPolicy')}
          customEnabled={draft.v8LoopPolicy.enabled}
          disabled={
            !draft.developer.enabled || !draft.v8LoopPolicy.enabled
          }
          onThresholdsChange={(thresholdsPatch) =>
            setDraft((prev) => ({
              ...prev,
              v8LoopPolicy: {
                ...prev.v8LoopPolicy,
                enabled: true,
                ...thresholdsPatch,
              },
            }))
          }
        />
      </SettingsSection>

      <SettingsSection
        title="Evidence"
        description="Session logs and shareable diagnostics for support."
      >
        <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!props.engineBaseUrl || props.busy}
            onClick={() => {
              if (!props.engineBaseUrl) return;
              void (async () => {
                try {
                  const result = await openLatestSessionLog({
                    baseUrl: props.engineBaseUrl!,
                    token: props.authToken,
                  });
                  const bridge = getDesktopBridge();
                  if (result.path && bridge?.revealInFolder) {
                    await bridge.revealInFolder(result.path);
                    setNote(`Opened session log: ${result.path}`);
                  } else if (result.message) {
                    setNote(result.message);
                  } else {
                    setNote('No session log path returned.');
                  }
                } catch (err) {
                  setNote(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              })();
            }}
          >
            Open session log
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!props.engineBaseUrl || props.busy}
            onClick={() => {
              if (!props.engineBaseUrl) return;
              void (async () => {
                try {
                  const result = await exportSessionLog({
                    baseUrl: props.engineBaseUrl!,
                    token: props.authToken,
                  });
                  const bridge = getDesktopBridge();
                  if (result.path && bridge?.revealInFolder) {
                    await bridge.revealInFolder(result.path);
                  }
                  setNote(
                    result.path
                      ? `Exported session log: ${result.path}`
                      : 'Session log export finished.',
                  );
                } catch (err) {
                  setNote(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              })();
            }}
          >
            Export session log
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!props.engineBaseUrl || props.busy}
            onClick={() => {
              if (!props.engineBaseUrl) return;
              void (async () => {
                try {
                  const result = await exportShareableDiagnostic({
                    baseUrl: props.engineBaseUrl!,
                    token: props.authToken,
                  });
                  const bridge = getDesktopBridge();
                  if (result.path && bridge?.revealInFolder) {
                    await bridge.revealInFolder(result.path);
                  }
                  setNote(
                    result.path
                      ? `Exported diagnostic: ${result.path}`
                      : 'Shareable diagnostic export finished.',
                  );
                } catch (err) {
                  setNote(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              })();
            }}
          >
            Export shareable diagnostic
          </button>
          <button
            type="button"
            className="btn btn-ghost"
            disabled={!props.engineBaseUrl || props.busy}
            onClick={() => {
              if (!props.engineBaseUrl) return;
              void (async () => {
                try {
                  const result = await exportAuditPack({
                    baseUrl: props.engineBaseUrl!,
                    token: props.authToken,
                  });
                  const bridge = getDesktopBridge();
                  if (result.path && bridge?.revealInFolder) {
                    await bridge.revealInFolder(result.path);
                  }
                  setNote(
                    result.path
                      ? `Exported audit pack: ${result.path}`
                      : 'Audit pack export finished.',
                  );
                } catch (err) {
                  setNote(
                    err instanceof Error ? err.message : String(err),
                  );
                }
              })();
            }}
          >
            Export audit pack
          </button>
        </div>
      </SettingsSection>
    </div>
  ) : null;
}
