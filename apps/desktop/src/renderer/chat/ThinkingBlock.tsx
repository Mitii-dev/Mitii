/**
 * Live “Brainstorming” block for assistant turns.
 * Always shown while streaming (after the summary, before file changes).
 * Settles to “Thought for Xs” when the run finishes.
 */

import { useEffect, useRef, useState } from 'react';

import type { DesktopActivityItem } from '../../shared/activity.js';

interface ThinkingBlockProps {
  items: DesktopActivityItem[];
  streaming?: boolean;
  /** When the assistant turn finished (for frozen “Thought for Xs”). */
  endAt?: number;
}

function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  return seconds < 60 ? `${seconds}s` : `${Math.round(seconds / 60)}m`;
}

function thinkingPreview(detail: string | undefined): string {
  return (detail ?? '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .slice(-14)
    .join('\n');
}

export function ThinkingBlock({
  items,
  streaming,
  endAt,
}: ThinkingBlockProps) {
  const active = Boolean(streaming);
  const [expanded, setExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const streamStartedRef = useRef<number | null>(null);
  const previewRef = useRef<HTMLPreElement | null>(null);

  const first = items[0];
  const last = items[items.length - 1];
  const detail = items
    .map((item) => item.detail ?? '')
    .filter(Boolean)
    .join('');
  const preview = thinkingPreview(detail);
  const startedAt = first?.at ?? streamStartedRef.current ?? Date.now();

  useEffect(() => {
    if (!active) {
      streamStartedRef.current = null;
      return;
    }
    if (streamStartedRef.current == null) {
      streamStartedRef.current = first?.at ?? Date.now();
    }
  }, [active, first?.at]);

  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 400);
    return () => window.clearInterval(id);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [active, preview]);

  // Always show while the model is running; otherwise only if we have thoughts.
  if (!active && items.length === 0) return null;

  const finishedAt =
    endAt ??
    items
      .map((item) => item.endedAt)
      .filter((value): value is number => typeof value === 'number')
      .at(-1) ??
    last?.at ??
    Date.now();

  const label = active
    ? 'Brainstorming'
    : `Thought for ${formatDuration(Math.max(0, finishedAt - startedAt))}`;

  const showPreview = active ? Boolean(preview) : expanded && Boolean(preview);
  const elapsedMs = active ? Math.max(0, now - startedAt) : 0;

  return (
    <div
      className={`thinking-block${active ? ' thinking-block--active' : ''}${
        expanded ? ' thinking-block--expanded' : ''
      }`}
      aria-label={label}
      aria-live={active ? 'polite' : undefined}
    >
      <button
        type="button"
        className="thinking-block__header"
        onClick={() => {
          if (active || !preview) return;
          setExpanded((v) => !v);
        }}
        disabled={active || !preview}
        aria-expanded={!active && preview ? expanded : undefined}
      >
        <span className="thinking-block__pulse" aria-hidden={!active}>
          {active ? <span className="thinking-block__pulse-dot" /> : null}
        </span>
        <span className="thinking-block__label">
          {label}
          {active ? (
            <span className="thinking-block__ellipsis" aria-hidden>
              <span />
              <span />
              <span />
            </span>
          ) : null}
        </span>
        {active ? (
          <span className="thinking-block__timer" aria-hidden>
            {formatDuration(elapsedMs)}
          </span>
        ) : preview ? (
          <span className="thinking-block__chevron" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        ) : null}
      </button>

      {showPreview ? (
        <pre ref={previewRef} className="thinking-block__preview">
          {preview}
          {active ? <span className="thinking-block__caret" aria-hidden /> : null}
        </pre>
      ) : active ? (
        <div className="thinking-block__skeleton" aria-hidden>
          <span />
          <span />
          <span />
        </div>
      ) : null}
    </div>
  );
}

export function thinkingItemsFromActivity(
  items: DesktopActivityItem[] | undefined,
): DesktopActivityItem[] {
  if (!items?.length) return [];
  return items.filter((item) => item.kind === 'thinking');
}
