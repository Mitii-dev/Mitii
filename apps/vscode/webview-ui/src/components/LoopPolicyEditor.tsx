import { useMemo } from 'react';

import type { TokenBudgetFieldDescriptor } from '../protocol';
import { NumberField } from './NumberField';

export function LoopPolicyEditor({
  fields,
  thresholds,
  customEnabled,
  disabled,
  onThresholdsChange,
}: {
  fields: TokenBudgetFieldDescriptor[];
  thresholds: Record<string, number>;
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

  return (
    <div className="token-budget-editor">
      <LoopPolicyFields
        fields={simpleFields}
        thresholds={thresholds}
        disabled={disabled || !customEnabled}
        onChange={(key, value) => onThresholdsChange({ [key]: value })}
      />
      <details className="settings-advanced">
        <summary>Advanced recoveries &amp; repair</summary>
        <LoopPolicyFields
          fields={advancedFields}
          thresholds={thresholds}
          disabled={disabled || !customEnabled}
          onChange={(key, value) => onThresholdsChange({ [key]: value })}
        />
      </details>
    </div>
  );
}

function LoopPolicyFields({
  fields,
  thresholds,
  disabled,
  onChange,
}: {
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
    <div className="token-budget-fields">
      {groups.map(([group, groupFields]) => (
        <div key={group} className="token-budget-group">
          <h4 className="settings-category__title">{group}</h4>
          <div className="settings-field-grid">
            {groupFields.map((field) => (
              <NumberField
                key={field.key}
                id={`loopPolicy.${field.key}`}
                label={field.label}
                min={field.min}
                max={field.max}
                step={field.step}
                integer={field.kind === 'int'}
                disabled={disabled}
                hint={
                  field.defaultValue !== undefined
                    ? `${field.description} Standard: ${field.defaultValue}.`
                    : field.description
                }
                value={thresholds[field.key] ?? field.defaultValue ?? field.min}
                onCommit={(value) => onChange(field.key, value)}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
