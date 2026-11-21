import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ModelQuickSelectCustom {
  /** True while a free-form model id is active. */
  active: boolean;
  /** Menu row label. */
  label?: string;
  onSelect: () => void;
  onDraftChange: (model: string) => void;
  onCommit: () => void;
}

export interface ModelQuickSelectProps {
  /** Active model id. */
  model: string;
  /** Selectable model ids; falls back to `[model]` when empty. */
  models: readonly string[];
  onChange: (model: string) => void;
  disabled?: boolean;
  loading?: boolean;
  /** Called when the menu opens (for example to refresh the model list). */
  onOpen?: () => void;
  /** Footer action, e.g. open Settings → Profiles. */
  onEditProfile?: () => void;
  editProfileLabel?: string;
  /** Trigger text override; defaults to the model id. */
  label?: string;
  /** Icon before the trigger text. */
  triggerIcon?: ReactNode;
  /** Mark rendered next to the selected option. */
  checkIcon?: ReactNode;
  /** Show the ▾ caret on the trigger. */
  showCaret?: boolean;
  /** Show a filter box once the list is longer than this many models. */
  filterThreshold?: number;
  /** Adds a "Custom model" row and an inline id input. */
  custom?: ModelQuickSelectCustom;
}

/** Compact model picker with filter, custom id, and profile shortcut. */
export function ModelQuickSelect({
  model,
  models,
  onChange,
  disabled,
  loading,
  onOpen,
  onEditProfile,
  editProfileLabel = 'Edit profile…',
  label,
  triggerIcon,
  checkIcon = '✓',
  showCaret = true,
  filterThreshold = 8,
  custom,
}: ModelQuickSelectProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const customActive = Boolean(custom?.active);
  const options = useMemo(() => {
    const base =
      models.length > 0 ? models : model && !customActive ? [model] : [];
    const q = query.trim().toLowerCase();
    if (!q) return base;
    return base.filter((id) => id.toLowerCase().includes(q));
  }, [models, model, customActive, query]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    // Defer so the click that opened the menu cannot close it.
    const timer = window.setTimeout(() => {
      window.addEventListener('pointerdown', onPointerDown);
    }, 0);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) setQuery('');
  }, [open]);

  const triggerText = loading
    ? 'Loading models…'
    : (label ?? (model || 'Select model'));

  return (
    <div className="model-quick-select" ref={rootRef}>
      <button
        type="button"
        className="model-quick-select__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        disabled={disabled}
        title={label ? `Model: ${label}` : 'Model'}
        onClick={() => {
          const next = !open;
          setOpen(next);
          if (next) onOpen?.();
        }}
      >
        {triggerIcon}
        <span>{triggerText}</span>
        {showCaret ? <span aria-hidden>▾</span> : null}
      </button>
      {open ? (
        <div className="model-quick-select__menu" role="listbox" aria-label="Model">
          {models.length > filterThreshold ? (
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
          {options.map((id) => {
            const selected = !customActive && id === model;
            return (
              <button
                key={id}
                type="button"
                role="option"
                aria-selected={selected}
                className={`model-quick-select__option${selected ? ' is-selected' : ''}`}
                onClick={() => {
                  onChange(id);
                  setOpen(false);
                }}
              >
                <span className="model-quick-select__option-text">{id}</span>
                <span className="model-quick-select__check" aria-hidden>
                  {selected ? checkIcon : null}
                </span>
              </button>
            );
          })}
          {custom ? (
            <button
              type="button"
              role="option"
              aria-selected={customActive}
              className={`model-quick-select__option${customActive ? ' is-selected' : ''}`}
              onClick={() => {
                custom.onSelect();
                setOpen(false);
              }}
            >
              <span className="model-quick-select__option-text">
                {custom.label ?? 'Custom model'}
              </span>
              <span className="model-quick-select__check" aria-hidden>
                {customActive ? checkIcon : null}
              </span>
            </button>
          ) : null}
          {!loading && options.length === 0 ? (
            <div className="model-quick-select__empty">
              {query.trim()
                ? 'No models match that filter'
                : 'No models for this profile — Test connection in Settings'}
            </div>
          ) : null}
          {onEditProfile ? (
            <button
              type="button"
              className="model-quick-select__footer"
              onClick={() => {
                setOpen(false);
                onEditProfile();
              }}
            >
              {editProfileLabel}
            </button>
          ) : null}
        </div>
      ) : null}
      {custom && customActive ? (
        <input
          className="model-custom-input model-custom-input--inline"
          value={model}
          placeholder="model id"
          onChange={(event) => custom.onDraftChange(event.target.value)}
          onBlur={custom.onCommit}
          title="Custom model id"
        />
      ) : null}
    </div>
  );
}
