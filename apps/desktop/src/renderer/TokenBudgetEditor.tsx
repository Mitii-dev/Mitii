/**
 * WIRING.md — SettingsPanel.tsx (Profiles / Developer)
 * - import { TokenBudgetEditor } from './TokenBudgetEditor.js'
 * - import { deriveLiveTokenBudgetPreview, type TokenBudgetPreview } from '../shared/liveTokenBudgetPreview.js'
 * - Replace CatalogNumberFields for tokenBudget with:
 *   <TokenBudgetEditor
 *     fields={windowBudgetFields}
 *     policy={draft.tokenBudget.policy ?? {}}
 *     preview={deriveLiveTokenBudgetPreview({ contextWindowTokens, policy })}
 *     customEnabled={draft.tokenBudget.enabled}
 *     outputOverride={!isAutoMaximumOutputTokens(maxOut)}
 *     disabled={!draft.developer.enabled || !draft.tokenBudget.enabled}
 *     onPolicyChange={(patch) => setDraft(… merge policy)}
 *   />
 */

import { useMemo, useState, type ReactNode } from 'react';

import {
  DEFAULT_WINDOW_BUDGET_NUMBERS,
  isFilesPerMutationPinned,
  isPolicyValueCustom,
  isVerificationChecksPinned,
  mergeLiveWindowBudgetPolicy,
  policyForFilesPerMutation,
  policyForVerificationChecks,
  safeSliderValue,
  type TokenBudgetPreview,
} from '../shared/liveTokenBudgetPreview.js';
import { TokenBudgetAllocation } from './TokenBudgetAllocation.js';

export interface TokenBudgetFieldDescriptor {
  key: string;
  group: string;
  label: string;
  description: string;
  kind: 'ratio' | 'int' | 'number';
  min: number;
  max?: number;
  step: number;
  defaultValue?: number;
  tier?: 'simple' | 'advanced';
  hiddenFromDebug?: boolean;
}

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

function FieldShell({
  id,
  label,
  hint,
  badge,
  footer,
  children,
}: {
  id: string;
  label: string;
  hint?: string;
  badge?: string;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="field full">
      <label htmlFor={id}>
        {label}
        {badge ? (
          <span className="token-budget-editor__badge"> {badge}</span>
        ) : null}
      </label>
      {children}
      {hint ? <p className="field-help">{hint}</p> : null}
      {footer}
    </div>
  );
}

function NumberCommitField({
  id,
  label,
  value,
  min,
  max,
  step,
  integer = true,
  disabled,
  hint,
  footer,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  integer?: boolean;
  disabled?: boolean;
  hint?: string;
  footer?: ReactNode;
  onCommit: (value: number) => void;
}) {
  const safe = Number.isFinite(value) ? value : (min ?? 0);
  return (
    <FieldShell id={id} label={label} hint={hint} footer={footer}>
      <input
        id={id}
        type="number"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={safe}
        onChange={(event) => {
          const parsed = Number(event.target.value);
          if (!Number.isFinite(parsed)) return;
          const rounded = integer ? Math.floor(parsed) : parsed;
          const bounded = Math.max(
            min ?? Number.NEGATIVE_INFINITY,
            Math.min(max ?? Number.POSITIVE_INFINITY, rounded),
          );
          onCommit(bounded);
        }}
      />
    </FieldShell>
  );
}

function SliderCommitField({
  id,
  label,
  value,
  min,
  max,
  step = 1,
  disabled,
  hint,
  badge,
  displayValue,
  footer,
  onCommit,
}: {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  disabled?: boolean;
  hint?: string;
  badge?: string;
  displayValue: string;
  footer?: ReactNode;
  onCommit: (value: number) => void;
}) {
  const bounded = safeSliderValue(value, min, max);
  return (
    <FieldShell id={id} label={label} hint={hint} badge={badge} footer={footer}>
      <div className="token-budget-editor__slider-row">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          disabled={disabled}
          value={bounded}
          onChange={(event) => onCommit(Number(event.target.value))}
        />
        <span className="mono token-budget-editor__slider-value">
          {displayValue}
        </span>
      </div>
    </FieldShell>
  );
}

function TokenBudgetFields({
  fields,
  policy,
  disabled,
  onChange,
}: {
  fields: TokenBudgetFieldDescriptor[];
  policy: Record<string, number>;
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
      <p className="field-help">
        Token-budget fields appear when the host provides descriptors.
      </p>
    );
  }

  return (
    <div className="token-budget-editor__fields">
      {groups.map(([group, groupFields]) => (
        <div key={group} className="token-budget-editor__group">
          <h4 className="token-budget-editor__group-title">{group}</h4>
          <div className="field-grid">
            {groupFields.map((field) => (
              <NumberCommitField
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
  const merged = mergeLiveWindowBudgetPolicy(
    customEnabled ? policy : undefined,
    preview.contextWindowTokens,
  );
  const activePolicy = customEnabled ? policy : DEFAULT_WINDOW_BUDGET_NUMBERS;
  const safeFields = Array.isArray(fields) ? fields : [];
  const filesPinned = customEnabled && isFilesPerMutationPinned(policy);
  const verificationPinned =
    customEnabled && isVerificationChecksPinned(policy);

  const shareFooter = (tokens: number, usableShare: number) => {
    const usableSum =
      merged.repositoryShare +
      merged.conversationShare +
      merged.planShare +
      merged.skillsShare;
    const freeUsable = Math.max(0, 1 - usableSum);
    return (
      <p className="field-help">
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

  return (
    <div className="token-budget-editor">
      <TokenBudgetAllocation preview={preview} />

      <div className="token-budget-editor__simple">
        <h4 className="token-budget-editor__group-title">Simple</h4>
        <p className="field-help">
          Module shares are of usable input and do not need to total 100%.
          Leftover shows as Free in the bar above.
        </p>
        <SliderCommitField
          id="tokenBudget.filesPerMutation"
          label="Files per mutation"
          min={1}
          max={48}
          step={1}
          disabled={disabled}
          hint="How many unique files one mutation call may touch."
          badge={filesPinned ? 'Custom' : 'Follows window'}
          value={preview.maxUniqueFilesPerCall}
          displayValue={String(preview.maxUniqueFilesPerCall)}
          onCommit={(value) => onPolicyChange(policyForFilesPerMutation(value))}
        />
        <SliderCommitField
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
              <p className="field-help">
                Provider → Max output is set, so this slider is unused.
              </p>
            ) : (
              <p className="field-help">
                {formatTokens(preview.maximumOutputTokens)} tokens reserved for
                the model reply.
              </p>
            )
          }
          onCommit={(value) => onPolicyChange({ outputRatio: value / 100 })}
        />
        <SliderCommitField
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
          onCommit={(value) =>
            onPolicyChange({ repositoryShare: value / 100 })
          }
        />
        <SliderCommitField
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
            onPolicyChange({ conversationShare: value / 100 })
          }
        />
        <SliderCommitField
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
          onCommit={(value) => onPolicyChange({ planShare: value / 100 })}
        />
        <SliderCommitField
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
          onCommit={(value) => onPolicyChange({ skillsShare: value / 100 })}
        />
        <SliderCommitField
          id="tokenBudget.verificationChecks"
          label="Verification checks"
          min={1}
          max={32}
          step={1}
          disabled={disabled}
          hint="How many verification checks may run after mutations."
          badge={verificationPinned ? 'Custom' : 'Follows window'}
          value={preview.maxVerificationChecks}
          displayValue={String(preview.maxVerificationChecks)}
          onCommit={(value) =>
            onPolicyChange(policyForVerificationChecks(value))
          }
        />
      </div>

      <details
        className="token-budget-editor__advanced"
        onToggle={(event) =>
          setAdvancedOpen((event.currentTarget as HTMLDetailsElement).open)
        }
        hidden={safeFields.length === 0}
      >
        <summary>Advanced</summary>
        {advancedOpen ? (
          <TokenBudgetFields
            fields={safeFields}
            policy={merged}
            disabled={disabled}
            onChange={(key, value) => onPolicyChange({ [key]: value })}
          />
        ) : null}
      </details>
    </div>
  );
}
