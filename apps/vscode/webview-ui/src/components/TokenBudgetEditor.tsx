import { useMemo, useState } from 'react';

import {
  DEFAULT_WINDOW_BUDGET_NUMBERS,
  isFilesPerMutationPinned,
  isPolicyValueCustom,
  isVerificationChecksPinned,
  mergeLiveWindowBudgetPolicy,
  policyForFilesPerMutation,
  policyForVerificationChecks,
} from '@mitii/live-token-budget';
import type {
  TokenBudgetFieldDescriptor,
  TokenBudgetPreview,
} from '../protocol';
import { NumberField } from './NumberField';
import { SliderField } from './SliderField';
import { TokenBudgetAllocation } from './TokenBudgetAllocation';
import { TokenBudgetFieldHelp } from './TokenBudgetFieldHelp';

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

function TokenBudgetFields({
  fields,
  policy,
  preview,
  disabled,
  onChange,
}: {
  fields: TokenBudgetFieldDescriptor[];
  policy: Record<string, number>;
  preview: TokenBudgetPreview;
  disabled: boolean;
  onChange: (key: string, value: number) => void;
}) {
  const groups = useMemo(() => {
    const next = new Map<string, TokenBudgetFieldDescriptor[]>();
    for (const field of fields) {
      if (field.hiddenFromDebug) continue;
      const group = next.get(field.group) ?? [];
      group.push(field);
      next.set(field.group, group);
    }
    return [...next.entries()];
  }, [fields]);

  if (fields.length === 0) {
    return (
      <p className="field-hint">
        Token-budget fields appear after the host sends settings.
      </p>
    );
  }

  return (
    <div className="token-budget-fields">
      {groups.map(([group, groupFields]) => (
        <div key={group} className="token-budget-group">
          <h4 className="settings-category__title">{group}</h4>
          <div className="settings-field-grid">
            {groupFields.map((field) => (
              <NumberField
                key={field.key}
                id={`tokenBudget.${field.key}`}
                label={field.label}
                min={field.min}
                max={field.max}
                step={field.step}
                integer={field.kind === 'int'}
                disabled={disabled}
                hint={field.description}
                value={policy[field.key] ?? field.min}
                footer={
                  <TokenBudgetFieldHelp
                    field={field}
                    value={policy[field.key] ?? field.min}
                    preview={preview}
                  />
                }
                onCommit={(value) => onChange(field.key, value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function TokenBudgetEditor({
  fields,
  policy,
  preview,
  customEnabled,
  outputOverride,
  disabled,
  onPolicyChange,
}: {
  fields: TokenBudgetFieldDescriptor[];
  policy: Record<string, number>;
  preview: TokenBudgetPreview;
  customEnabled: boolean;
  outputOverride: boolean;
  disabled: boolean;
  onPolicyChange: (patch: Record<string, number>) => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const merged = mergeLiveWindowBudgetPolicy(customEnabled ? policy : undefined);
  const activePolicy = customEnabled ? policy : DEFAULT_WINDOW_BUDGET_NUMBERS;
  const safeFields = Array.isArray(fields) ? fields : [];
  const filesPinned = customEnabled && isFilesPerMutationPinned(policy);
  const verificationPinned =
    customEnabled && isVerificationChecksPinned(policy);

  const commitPolicy = (patch: Record<string, number>) => {
    onPolicyChange(patch);
  };

  const shareFooter = (tokens: number, usableShare: number) => (
    <p className="field-hint">
      {formatPercent(windowShare(tokens, preview))} of the context window ·{' '}
      {formatTokens(tokens)} tokens · {formatPercent(usableShare)} of usable
      input
    </p>
  );

  return (
    <div className="token-budget-editor">
      <TokenBudgetAllocation preview={preview} />

      <div className="token-budget-simple">
        <h4 className="settings-category__title">Simple</h4>
        <p className="field-hint">
          These follow the context window unless you move a slider. Custom
          values stay put when the window changes.
        </p>
        <SliderField
          id="tokenBudget.filesPerMutation"
          label="Files per mutation"
          min={1}
          max={48}
          step={1}
          disabled={disabled}
          hint="How many unique files one mutation call may touch. Scales with the context window until you set a custom value."
          badge={filesPinned ? 'Custom' : 'Follows window'}
          value={preview.maxUniqueFilesPerCall}
          displayValue={String(preview.maxUniqueFilesPerCall)}
          onCommit={(value) => commitPolicy(policyForFilesPerMutation(value))}
        />
        <SliderField
          id="tokenBudget.outputRatio"
          label="Output reserve"
          min={0}
          max={100}
          step={1}
          disabled={disabled || outputOverride}
          hint="Share of the context window reserved for model output when Max output is 0."
          badge={
            outputOverride
              ? 'Max output override'
              : isPolicyValueCustom(activePolicy, 'outputRatio')
                ? 'Custom'
                : 'Follows window'
          }
          value={Math.round(merged.outputRatio * 100)}
          displayValue={`${formatPercent(windowShare(preview.maximumOutputTokens, preview))} · ${formatTokens(preview.maximumOutputTokens)} tokens`}
          footer={
            outputOverride ? (
              <p className="field-hint">
                Provider → Max output is set, so this slider is unused.
              </p>
            ) : (
              <p className="field-hint">
                {formatTokens(preview.maximumOutputTokens)} tokens reserved for
                the model reply.
              </p>
            )
          }
          onCommit={(value) => commitPolicy({ outputRatio: value / 100 })}
        />
        <SliderField
          id="tokenBudget.repositoryShare"
          label="Repository"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          hint="Share of usable input spent on repository context."
          badge={
            isPolicyValueCustom(activePolicy, 'repositoryShare')
              ? 'Custom'
              : 'Follows window'
          }
          value={Math.round(merged.repositoryShare * 100)}
          displayValue={`${formatPercent(windowShare(preview.repositoryTokens, preview))} of window`}
          footer={shareFooter(preview.repositoryTokens, merged.repositoryShare)}
          onCommit={(value) => commitPolicy({ repositoryShare: value / 100 })}
        />
        <SliderField
          id="tokenBudget.conversationShare"
          label="Conversation"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          hint="Share of usable input spent on conversation and tool history."
          badge={
            isPolicyValueCustom(activePolicy, 'conversationShare')
              ? 'Custom'
              : 'Follows window'
          }
          value={Math.round(merged.conversationShare * 100)}
          displayValue={`${formatPercent(windowShare(preview.conversationTokens, preview))} of window`}
          footer={shareFooter(
            preview.conversationTokens,
            merged.conversationShare,
          )}
          onCommit={(value) =>
            commitPolicy({ conversationShare: value / 100 })
          }
        />
        <SliderField
          id="tokenBudget.planShare"
          label="Plan"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          hint="Share of usable input spent on plan text."
          badge={
            isPolicyValueCustom(activePolicy, 'planShare')
              ? 'Custom'
              : 'Follows window'
          }
          value={Math.round(merged.planShare * 100)}
          displayValue={`${formatPercent(windowShare(preview.planTokens, preview))} of window`}
          footer={shareFooter(preview.planTokens, merged.planShare)}
          onCommit={(value) => commitPolicy({ planShare: value / 100 })}
        />
        <SliderField
          id="tokenBudget.skillsShare"
          label="Skills"
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          hint="Share of usable input spent on skill bodies."
          badge={
            isPolicyValueCustom(activePolicy, 'skillsShare')
              ? 'Custom'
              : 'Follows window'
          }
          value={Math.round(merged.skillsShare * 100)}
          displayValue={`${formatPercent(windowShare(preview.skillsTokens, preview))} of window`}
          footer={shareFooter(preview.skillsTokens, merged.skillsShare)}
          onCommit={(value) => commitPolicy({ skillsShare: value / 100 })}
        />
        <SliderField
          id="tokenBudget.verificationChecks"
          label="Verification checks"
          min={1}
          max={32}
          step={1}
          disabled={disabled}
          hint="How many verification checks may run after mutations. Scales with usable input until you set a custom value."
          badge={verificationPinned ? 'Custom' : 'Follows window'}
          value={preview.maxVerificationChecks}
          displayValue={String(preview.maxVerificationChecks)}
          onCommit={(value) =>
            commitPolicy(policyForVerificationChecks(value))
          }
        />
      </div>

      <details
        className="settings-advanced token-budget-advanced"
        onToggle={(event) =>
          setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)
        }
      >
        <summary>Advanced</summary>
        {advancedOpen ? (
          <>
            <p className="field-hint">
              Core ratios and clamps. Leave these alone unless a Simple slider
              is not enough.
            </p>
            <TokenBudgetFields
              fields={safeFields}
              policy={merged}
              preview={preview}
              disabled={disabled}
              onChange={(key, value) => commitPolicy({ [key]: value })}
            />
          </>
        ) : null}
      </details>
    </div>
  );
}
