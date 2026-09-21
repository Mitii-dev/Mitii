import { useEffect, useRef, useState } from 'react';

interface ModelQuickSelectProps {
  model: string;
  models: string[];
  disabled?: boolean;
  onChange: (model: string) => void;
}

export function ModelQuickSelect({
  model,
  models,
  disabled,
  onChange,
}: ModelQuickSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = models.length > 0 ? models : model ? [model] : [];

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div className="model-quick-select" ref={rootRef}>
      <button
        type="button"
        className="model-quick-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title="Model"
        onClick={() => setOpen((v) => !v)}
      >
        <span>{model || 'Select model'}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="model-quick-select__menu" role="listbox" aria-label="Model">
          {options.map((id) => (
            <button
              key={id}
              type="button"
              role="option"
              aria-selected={id === model}
              className={`model-quick-select__option${
                id === model ? ' is-selected' : ''
              }`}
              onClick={() => {
                onChange(id);
                setOpen(false);
              }}
            >
              <span className="model-quick-select__option-text">{id}</span>
              {id === model ? (
                <span className="model-quick-select__check" aria-hidden>
                  ✓
                </span>
              ) : null}
            </button>
          ))}
          {options.length === 0 ? (
            <div className="model-quick-select__empty">
              Open Settings to pick a model
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
