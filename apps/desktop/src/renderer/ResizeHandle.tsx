import { useEffect, useRef, useState } from 'react';

function readStoredWidth(key: string, fallback: number): number {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const n = Number(raw);
    return Number.isFinite(n) ? n : fallback;
  } catch {
    return fallback;
  }
}

export function usePersistedWidth(
  key: string,
  defaults: { initial: number; min: number; max: number },
): [number, (next: number) => void] {
  const [width, setWidthState] = useState(() =>
    Math.min(
      defaults.max,
      Math.max(defaults.min, readStoredWidth(key, defaults.initial)),
    ),
  );

  const setWidth = (next: number) => {
    const clamped = Math.min(defaults.max, Math.max(defaults.min, next));
    setWidthState(clamped);
    try {
      localStorage.setItem(key, String(Math.round(clamped)));
    } catch {
      /* ignore */
    }
  };

  return [width, setWidth];
}

interface ResizeHandleProps {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  /** Reverse drag (panel on the right grows when dragging left). */
  reverse?: boolean;
  label?: string;
}

export function ResizeHandle(props: ResizeHandleProps) {
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ startX: number; startValue: number } | null>(null);
  const min = props.min ?? 160;
  const max = props.max ?? 720;

  useEffect(() => {
    if (!dragging) return;

    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const onMove = (e: PointerEvent) => {
      const s = drag.current;
      if (!s) return;
      const dx = e.clientX - s.startX;
      const next = s.startValue + (props.reverse ? -dx : dx);
      props.onChange(Math.min(max, Math.max(min, next)));
    };
    const onUp = () => {
      drag.current = null;
      setDragging(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [dragging, max, min, props]);

  return (
    <div
      className={`resize-handle${dragging ? ' is-dragging' : ''}`}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={Math.round(props.value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-label={props.label ?? 'Resize panel'}
      onPointerDown={(e) => {
        e.preventDefault();
        drag.current = { startX: e.clientX, startValue: props.value };
        setDragging(true);
      }}
    />
  );
}
