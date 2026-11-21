import { useState, type ReactNode } from 'react';

import {
  DEFAULT_WINDOW_BUDGET_NUMBERS,
  isFilesPerMutationPinned,
  isPolicyValueCustom,
  isVerificationChecksPinned,
  mergeLiveWindowBudgetPolicy,
  policyForFilesPerMutation,
  policyForVerificationChecks,
  type TokenBudgetPreview,
} from '@mitii/ui-core';

import { TokenBudgetAllocation } from '../TokenBudgetAllocation.js';
import { SliderField } from './SliderField.js';
import { TokenBudgetFields } from './TokenBudgetFields.js';
import type {
  RenderTokenBudgetFieldHelp,
  TokenBudgetFieldDescriptor,
  TokenBudgetHintMode,
} from './types.js';

function formatTokens(value: number): string {
  const tokens = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(
    Math.max(0, Math.floor(tokens)),
  );
}

function formatPercent(share: number): string {
  const ratio = Number.isFinite(share) ? share : 0;
  return `${Math.round(ratio * 1000) / 10}%`;
}

function windowShare(tokens: number, preview: TokenBudgetPreview): number {
  return preview.contextWindowTokens > 0
    ? tokens / preview.contextWindowTokens
    : 0;
}

export interface TokenBudgetEditorProps {
  /** Advanced policy descriptors; an empty list hides the Advanced section. */
  fields: readonly TokenBudgetFieldDescriptor[];
  policy: Record<string, number>;
  preview: TokenBudgetPreview;
  customEnabled: boolean;
  /** True when Provider → Max output overrides the output-reserve slider. */
  outputOverride: boolean;
  disabled: boolean;
  onPolicyChange: (patch: Record<string, number>) => void;
  /** Field help under Advanced number fields (docs links, derived hints). */
  renderFieldHelp?: RenderTokenBudgetFieldHelp;
  /** Show descriptions as tooltips (default) or as paragraphs under fields. */
  hintMode?: TokenBudgetHintMode;
}

type ShareKey =
  | 'repositoryShare'
  | 'conversationShare'
  | 'planShare'
  | 'skillsShare';

/** Allocation chart plus Simple sliders and optional Advanced policy fields. */
export function TokenBudgetEditor({
  fields,
  policy,
  preview,
  customEnabled,
  outputOverride,
  disabled,
  onPolicyChange,
  renderFieldHelp,
  hintMode = 'tooltip',
}: TokenBudgetEditorProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const merged = mergeLiveWindowBudgetPolicy(
    customEnabled ? policy : undefined,
    preview.contextWindowTokens,
  );
  const activePolicy = customEnabled ? policy : DEFAULT_WINDOW_BUDGET_NUMBERS;
  const safeFields = Array.isArray(fields) ? fields : [];
  const filesPinned = customEnabled && isFilesPerMutationPinned(policy);
  const verificationPinned =
    customEnabled && isVerificationChecksPinned(policy);
  const inline = hintMode === 'inline';

  const withHint = (hint: string, footer?: ReactNode): ReactNode =>
    inline ? (
      <>
        <p className="field-hint">{hint}</p>
        {footer}
      </>
    ) : (
      footer
    );

  const shareFooter = (tokens: number, usableShare: number) => {
    const usableSum =
      merged.repositoryShare +
      merged.conversationShare +
      merged.planShare +
      merged.skillsShare;
    const freeUsable = Math.max(0, 1 - usableSum);
    return (
      <p className="field-hint">
        {formatPercent(windowShare(tokens, preview))} of the context window ·{' '}
        {formatTokens(tokens)} tokens · {formatPercent(usableShare)} of usable
        input
        {freeUsable > 0.001 ? (
          <>
            {' '}
            · <strong>{formatPercent(freeUsable)} free</strong> of usable (
            {formatTokens(preview.systemTokens)} tokens unallocated)
          </>
        ) : null}
      </p>
    );
  };

  const shareSlider = (
    key: ShareKey,
    label: string,
    hint: string,
    tokens: number,
  ) => (
    <SliderField
      id={`tokenBudget.${key}`}
      label={label}
      min={0}
      max={100}
      step={1}
      disabled={disabled}
      hint={hint}
      badge={isPolicyValueCustom(activePolicy, key) ? 'Custom' : 'Follows window'}
      value={Math.round(merged[key] * 100)}
      displayValue={`${formatPercent(windowShare(tokens, preview))} of window`}
      footer={withHint(hint, shareFooter(tokens, merged[key]))}
      onCommit={(value) => onPolicyChange({ [key]: value / 100 })}
    />
  );

  const filesHint =
    'How many unique files one mutation call may touch. Scales with the context window until you set a custom value.';
  const outputHint =
    'Share of the context window reserved for model output when Max output is 0.';
  const verificationHint =
    'How many verification checks may run after mutations. Scales with usable input until you set a custom value.';

  return (
    <div className="token-budget-editor">
      <TokenBudgetAllocation preview={preview} />

      <div className="token-budget-simple">
        <h4 className="settings-category__title">Simple</h4>
        <p className="field-hint">
          Module shares are of usable input and do not need to total 100%.
          Leftover shows as Free in the bar above. Values follow the context
          window unless you move a slider.
        </p>
        <SliderField
          id="tokenBudget.filesPerMutation"
          label="Files per mutation"
          min={1}
          max={48}
          step={1}
          disabled={disabled}
          hint={filesHint}
          badge={filesPinned ? 'Custom' : 'Follows window'}
          value={preview.maxUniqueFilesPerCall}
          displayValue={String(preview.maxUniqueFilesPerCall)}
          footer={withHint(filesHint)}
          onCommit={(value) => onPolicyChange(policyForFilesPerMutation(value))}
        />
        <SliderField
          id="tokenBudget.outputRatio"
          label="Output reserve"
          min={0}
          max={100}
          step={1}
          disabled={disabled || outputOverride}
          hint={outputHint}
          badge={
            outputOverride
              ? 'Max output override'
              : isPolicyValueCustom(activePolicy, 'outputRatio')
                ? 'Custom'
                : 'Follows window'
          }
          value={Math.round(merged.outputRatio * 100)}
          displayValue={`${formatPercent(windowShare(preview.maximumOutputTokens, preview))} · ${formatTokens(preview.maximumOutputTokens)} tokens`}
          footer={withHint(
            outputHint,
            outputOverride ? (
              <p className="field-hint">
                Provider → Max output is set, so this slider is unused.
              </p>
            ) : (
              <p className="field-hint">
                {formatTokens(preview.maximumOutputTokens)} tokens reserved for
                the model reply.
              </p>
            ),
          )}
          onCommit={(value) => onPolicyChange({ outputRatio: value / 100 })}
        />
        {shareSlider(
          'repositoryShare',
          'Repository',
          'Share of usable input spent on repository context.',
          preview.repositoryTokens,
        )}
        {shareSlider(
          'conversationShare',
          'Conversation',
          'Share of usable input spent on conversation and tool history.',
          preview.conversationTokens,
        )}
        {shareSlider(
          'planShare',
          'Plan',
          'Share of usable input spent on plan text.',
          preview.planTokens,
        )}
        {shareSlider(
          'skillsShare',
          'Skills',
          'Share of usable input spent on skill bodies.',
          preview.skillsTokens,
        )}
        <SliderField
          id="tokenBudget.verificationChecks"
          label="Verification checks"
          min={1}
          max={32}
          step={1}
          disabled={disabled}
          hint={verificationHint}
          badge={verificationPinned ? 'Custom' : 'Follows window'}
          value={preview.maxVerificationChecks}
          displayValue={String(preview.maxVerificationChecks)}
          footer={withHint(verificationHint)}
          onCommit={(value) =>
            onPolicyChange(policyForVerificationChecks(value))
          }
        />
      </div>

      <details
        className="settings-advanced token-budget-advanced"
        onToggle={(event) =>
          setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)
        }
        hidden={safeFields.length === 0}
      >
        <summary>Advanced</summary>
        {advancedOpen ? (
          <>
            <p className="field-hint">
              Core ratios and clamps. Prefer <code>pnpm policy-admin</code> for
              ship defaults.
            </p>
            <TokenBudgetFields
              fields={safeFields}
              policy={merged}
              disabled={disabled}
              hintMode={hintMode}
              renderFieldHelp={renderFieldHelp}
              onChange={(key, value) => onPolicyChange({ [key]: value })}
            />
          </>
        ) : null}
      </details>
    </div>
  );
}
