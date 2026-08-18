import { useEffect, useRef, useState, type ReactNode } from 'react';

import { safeSliderValue } from '@mitii/live-token-budget';

export function SliderField({
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
  const safeStep = Number.isFinite(step) && step > 0 ? step : 1;
  const bounded = safeSliderValue(value, min, max);
  const [draft, setDraft] = useState(String(bounded));
  const focusedRef = useRef(false);

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(bounded));
    }
  }, [bounded]);

  const clamp = (raw: number): number => {
    if (!Number.isFinite(raw)) return bounded;
    const snapped = Math.round(raw / safeStep) * safeStep;
    const rounded =
      safeStep >= 1 ? Math.round(snapped) : Number(snapped.toFixed(4));
    return safeSliderValue(rounded, min, max);
  };

  const commit = (raw: number) => {
    const next = clamp(raw);
    setDraft(String(next));
    if (next !== bounded) onCommit(next);
  };

  return (
    <div className={`slider-field${disabled ? ' is-disabled' : ''}`}>
      <div className="slider-field__header">
        <label htmlFor={id}>
          {label}
          {badge ? <span className="slider-field__badge">{badge}</span> : null}
        </label>
        <span className="slider-field__value mono">{displayValue}</span>
      </div>
      <div className="slider-field__controls">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={safeStep}
          disabled={disabled}
          title={hint}
          value={bounded}
          onChange={(event) => commit(Number(event.target.value))}
        />
        <input
          className="slider-field__number"
          type="number"
          inputMode="numeric"
          min={min}
          max={max}
          step={safeStep}
          disabled={disabled}
          value={draft}
          onFocus={() => {
            focusedRef.current = true;
          }}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={() => {
            focusedRef.current = false;
            const parsed = Number(draft);
            if (!Number.isFinite(parsed)) {
              setDraft(String(bounded));
              return;
            }
            commit(parsed);
          }}
        />
      </div>
      {footer}
    </div>
  );
}
