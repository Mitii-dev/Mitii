import { useEffect, useMemo, useRef, useState } from 'react';

interface ModelQuickSelectProps {
  model: string;
  models: string[];
  disabled?: boolean;
  loading?: boolean;
  onChange: (model: string) => void;
  onOpen?: () => void;
}

export function ModelQuickSelect({
  model,
  models,
  disabled,
  loading,
  onChange,
  onOpen,
}: ModelQuickSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const options = useMemo(() => {
    const base = models.length > 0 ? models : model ? [model] : [];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((id) => id.toLowerCase().includes(q));
  }, [models, model, query]);

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

  useEffect(() => {
    if (!open) setQuery('');
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
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
      >
        <span>{loading ? 'Loading models…' : model || 'Select model'}</span>
        <span aria-hidden>▾</span>
      </button>
      {open ? (
        <div className="model-quick-select__menu" role="listbox" aria-label="Model">
          {models.length > 8 ? (
            <input
              className="model-quick-select__search"
              type="search"
              placeholder="Filter models…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : null}
          {loading && models.length === 0 ? (
            <div className="model-quick-select__empty">Fetching models…</div>
          ) : null}
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
          {!loading && options.length === 0 ? (
            <div className="model-quick-select__empty">
              {query.trim()
                ? 'No models match that filter'
                : 'No models for this profile — Test connection in Settings'}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
