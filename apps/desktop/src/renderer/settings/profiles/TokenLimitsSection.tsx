/** Context window and output token limits. */

import { normalizeMaximumOutputTokens } from '@mitii/ui-core';
import { TokenBudgetAllocation } from '@mitii/ui-react';
import type { ProfileSettingsModel } from './useProfileSettingsModel.js';
import { SettingsSection, Field } from './fields.js';

export function TokenLimitsSection({ m }: { m: ProfileSettingsModel }) {
  const {
    props,
    displayMaxOutput,
    previewContextWindow,
    autoMaxOutput,
    livePreview,
    storedMaxOutput,
  } = m;

  return (
    <SettingsSection
      title="Token limits"
      description="Set the context window for this machine. Retrieval, compaction, mutation batches, and verification update immediately from that window."
    >
      <div className="field-grid">
        <Field id="ctx" label="Context window">
          <input
            id="ctx"
            type="number"
            min={0}
            step={1}
            value={props.draft.provider.contextWindow}
            onChange={(e) =>
              props.patch({
                provider: {
                  ...props.draft.provider,
                  contextWindow: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                },
              })
            }
          />
        </Field>
        <Field id="maxOut" label="Max output">
          <input
            id="maxOut"
            type="number"
            min={0}
            step={1}
            value={displayMaxOutput}
            onChange={(e) => {
              const next = normalizeMaximumOutputTokens(
                Number(e.target.value) || 0,
              );
              props.patch({
                provider: {
                  ...props.draft.provider,
                  maximumOutputTokens: next,
                },
              });
            }}
          />
        </Field>
      </div>
      <p className="field-help">
        {props.draft.provider.contextWindow === 0
          ? `Context window 0 uses the model preset (preview ${previewContextWindow.toLocaleString()} tokens).`
          : `Context window will save as ${props.draft.provider.contextWindow.toLocaleString()} tokens.`}
      </p>
      <p className="field-help">
        {autoMaxOutput
          ? `Max output auto-scales with the window (${livePreview.maximumOutputTokens.toLocaleString()} tokens). Enter 0 to keep auto, or a positive number to override.`
          : `Max output will save as ${storedMaxOutput.toLocaleString()} tokens (fixed override). Set to 0 to resume auto-scaling.`}
      </p>
      <p className="field-help">
        These values follow the context window as you edit it. Use Developer →
        Token budget if you need sliders for files per mutation or module
        shares.
      </p>
      <TokenBudgetAllocation preview={livePreview} />
      <dl className="token-budget-kv">
        {(
          [
            ['Effective window', livePreview.contextWindowTokens],
            ['Usable input', livePreview.usableInputTokens],
            ['Output reserve', livePreview.maximumOutputTokens],
            ['Model-call cap', livePreview.maxModelCalls],
            ['Files per mutation', livePreview.maxUniqueFilesPerCall],
            ['Verification checks', livePreview.maxVerificationChecks],
          ] as const
        ).map(([label, value]) => (
          <div key={label} className="token-budget-kv__row">
            <dt>{label}</dt>
            <dd className="mono">{value.toLocaleString()}</dd>
          </div>
        ))}
      </dl>
    </SettingsSection>
  );
}
