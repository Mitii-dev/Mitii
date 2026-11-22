/**
 * WIRING.md — SettingsPanel.tsx (Developer)
 * - import { LoopPolicyEditor } from './LoopPolicyEditor.js'
 * - Replace CatalogNumberFields for loopPolicy with:
 *   <LoopPolicyEditor
 *     fields={loopPolicyFields}
 *     thresholds={draft.loopPolicy thresholds map}
 *     bandThresholds={band defaults for current context window}
 *     customEnabled={draft.loopPolicy.enabled}
 *     disabled={!draft.developer.enabled || !draft.loopPolicy.enabled}
 *     onThresholdsChange={(patch) => setDraft(… merge thresholds)}
 *   />
 */

import { useMemo } from 'react';

import type { TokenBudgetFieldDescriptor } from '@mitii/ui-react';

export function LoopPolicyEditor({
  idPrefix = 'loopPolicy',
  fields,
  thresholds,
  bandThresholds,
  customEnabled,
  disabled,
  onThresholdsChange,
}: {
  /** Setting prefix used for input ids (`loopPolicy` or `v8LoopPolicy`). */
  idPrefix?: string;
  fields: TokenBudgetFieldDescriptor[];
  thresholds: Record<string, number>;
  bandThresholds: Record<string, number>;
  customEnabled: boolean;
  disabled: boolean;
  onThresholdsChange: (patch: Record<string, number>) => void;
}) {
  const simpleFields = useMemo(
    () => fields.filter((field) => field.tier !== 'advanced'),
    [fields],
  );
  const advancedFields = useMemo(
    () => fields.filter((field) => field.tier === 'advanced'),
    [fields],
  );

  const displayThresholds = customEnabled ? thresholds : bandThresholds;

  return (
    <div className="token-budget-editor">
      <LoopPolicyFields
        idPrefix={idPrefix}
        fields={simpleFields}
        thresholds={displayThresholds}
        disabled={disabled || !customEnabled}
        onChange={(key, value) => onThresholdsChange({ [key]: value })}
      />
      <details className="token-budget-editor__advanced">
        <summary>Advanced recoveries &amp; repair</summary>
        <LoopPolicyFields
          idPrefix={idPrefix}
          fields={advancedFields}
          thresholds={displayThresholds}
          disabled={disabled || !customEnabled}
          onChange={(key, value) => onThresholdsChange({ [key]: value })}
        />
      </details>
    </div>
  );
}

function LoopPolicyFields({
  idPrefix,
  fields,
  thresholds,
  disabled,
  onChange,
}: {
  idPrefix: string;
  fields: TokenBudgetFieldDescriptor[];
  thresholds: Record<string, number>;
  disabled: boolean;
  onChange: (key: string, value: number) => void;
}) {
  const groups = useMemo(() => {
    const next = new Map<string, TokenBudgetFieldDescriptor[]>();
    for (const field of fields) {
      const group = next.get(field.group) ?? [];
      group.push(field);
      next.set(field.group, group);
    }
    return [...next.entries()];
  }, [fields]);

  if (fields.length === 0) {
    return null;
  }

  return (
    <div className="token-budget-editor__fields">
      {groups.map(([group, groupFields]) => (
        <div key={group} className="token-budget-editor__group">
          <h4 className="token-budget-editor__group-title">{group}</h4>
          <div className="field-grid">
            {groupFields.map((field) => {
              const value =
                thresholds[field.key] ?? field.defaultValue ?? field.min;
              return (
                <div key={field.key} className="field">
                  <label htmlFor={`${idPrefix}.${field.key}`}>
                    {field.label}
                  </label>
                  <input
                    id={`${idPrefix}.${field.key}`}
                    type="number"
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    disabled={disabled}
                    value={Number.isFinite(value) ? value : field.min}
                    onChange={(event) => {
                      const parsed = Number(event.target.value);
                      if (!Number.isFinite(parsed)) return;
                      const rounded =
                        field.kind === 'int' ? Math.floor(parsed) : parsed;
                      const bounded = Math.max(
                        field.min,
                        Math.min(field.max ?? Number.POSITIVE_INFINITY, rounded),
                      );
                      onChange(field.key, bounded);
                    }}
                  />
                  <p className="field-help">
                    {field.defaultValue !== undefined
                      ? `${field.description} Standard: ${field.defaultValue}.`
                      : field.description}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
