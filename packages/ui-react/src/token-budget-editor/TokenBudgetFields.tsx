import { useMemo } from 'react';

import { NumberField } from './NumberField.js';
import type {
  RenderTokenBudgetFieldHelp,
  TokenBudgetFieldDescriptor,
  TokenBudgetHintMode,
} from './types.js';

export interface TokenBudgetFieldsProps {
  fields: readonly TokenBudgetFieldDescriptor[];
  policy: Record<string, number>;
  disabled: boolean;
  hintMode: TokenBudgetHintMode;
  renderFieldHelp?: RenderTokenBudgetFieldHelp | undefined;
  onChange: (key: string, value: number) => void;
}

/**
 * Grouped number fields for host-provided policy descriptors. These render in
 * the Advanced section, so `tier: 'simple'` descriptors are skipped (the
 * editor already shows them as Simple sliders) as are `hiddenFromDebug` ones.
 */
export function TokenBudgetFields({
  fields,
  policy,
  disabled,
  hintMode,
  renderFieldHelp,
  onChange,
}: TokenBudgetFieldsProps) {
  const groups = useMemo(() => {
    const next = new Map<string, TokenBudgetFieldDescriptor[]>();
    for (const field of fields) {
      if (field.hiddenFromDebug || field.tier === 'simple') continue;
      const group = next.get(field.group) ?? [];
      group.push(field);
      next.set(field.group, group);
    }
    return [...next.entries()];
  }, [fields]);

  if (fields.length === 0) {
    return (
      <p className="field-hint">
        Token-budget fields appear when the host provides descriptors.
      </p>
    );
  }

  return (
    <div className="token-budget-fields">
      {groups.map(([group, groupFields]) => (
        <div key={group} className="token-budget-group">
          <h4 className="settings-category__title">{group}</h4>
          <div className="settings-field-grid">
            {groupFields.map((field) => {
              const value = policy[field.key] ?? field.min;
              const help = renderFieldHelp?.(field, value);
              return (
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
                  value={value}
                  footer={
                    hintMode === 'inline' || help ? (
                      <>
                        {hintMode === 'inline' ? (
                          <p className="field-hint">{field.description}</p>
                        ) : null}
                        {help}
                      </>
                    ) : undefined
                  }
                  onCommit={(next) => onChange(field.key, next)}
                />
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
