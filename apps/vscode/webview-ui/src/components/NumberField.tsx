import { useEffect, useRef, useState, type ReactNode } from 'react';

export function NumberField({
  id,
  label,
  value,
  min,
  max,
  step,
  disabled,
  integer = true,
  hint,
  footer,
  onCommit,
  onDraftChange,
}: {
  id: string;
  label: string;
  value: number;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
  integer?: boolean;
  hint?: string;
  footer?: ReactNode;
  onCommit: (value: number) => void;
  onDraftChange?: (value: number | undefined) => void;
}) {
  const safeValue = Number.isFinite(value) ? value : (min ?? 0);
  const [draft, setDraft] = useState(String(safeValue));
  const draftRef = useRef(draft);
  const focusedRef = useRef(false);
  draftRef.current = draft;

  useEffect(() => {
    if (!focusedRef.current) {
      setDraft(String(safeValue));
    }
  }, [safeValue]);

  const parseDraft = (nextDraft: string): number | undefined => {
    if (!nextDraft.trim()) {
      return undefined;
    }
    const parsed = Number(nextDraft);
    if (!Number.isFinite(parsed)) {
      return undefined;
    }
    const rounded = integer ? Math.floor(parsed) : parsed;
    return Math.max(
      min ?? Number.NEGATIVE_INFINITY,
      Math.min(max ?? Number.POSITIVE_INFINITY, rounded),
    );
  };

  const commit = (nextDraft: string) => {
    const bounded = parseDraft(nextDraft);
    if (bounded === undefined) {
      setDraft(String(safeValue));
      onDraftChange?.(undefined);
      return;
    }
    setDraft(String(bounded));
    onDraftChange?.(bounded);
    if (bounded !== safeValue) onCommit(bounded);
  };

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step="any"
        disabled={disabled}
        title={hint}
        data-step={step}
        value={draft}
        onFocus={() => {
          focusedRef.current = true;
        }}
        onChange={(e) => {
          const nextDraft = e.target.value;
          draftRef.current = nextDraft;
          setDraft(nextDraft);
          onDraftChange?.(parseDraft(nextDraft));
        }}
        onBlur={() => {
          focusedRef.current = false;
          commit(draftRef.current);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit(draftRef.current);
          }
        }}
      />
      {footer}
    </div>
  );
}
