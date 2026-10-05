import { useEffect, useRef, useState } from 'react';

import type { DesktopActivityItem } from '../../shared/activity.js';
import {
  nextTypedLength,
  typedSlice,
} from './thinkingTypeReveal.js';
import {
  thinkingPreview,
  thinkingSegmentLabel,
  timelineRowsForPaint,
} from './timelineThinking.js';

interface ActivityTimelineProps {
  items: DesktopActivityItem[];
  streaming?: boolean;
  /** When the assistant turn finished (for final thinking durations). */
  endAt?: number;
}

const BRANCHES = ['arc', 'elbow', 'reach', 'twig'] as const;
const TYPE_TICK_MS = 28;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function rowState(
  item: DesktopActivityItem,
  running: boolean,
): 'muted' | 'active' | 'done' | 'warn' {
  if (item.status === 'failed' || item.kind === 'warning' || item.kind === 'suspended') {
    return 'warn';
  }
  if (running) return 'active';
  if (item.status === 'done' || item.status === 'completed') return 'done';
  return 'muted';
}

function ThinkingRow({
  item,
  index,
  items,
  streaming,
  endAt,
  running,
}: {
  item: DesktopActivityItem;
  index: number;
  items: DesktopActivityItem[];
  streaming: boolean;
  endAt?: number;
  running: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const previewRef = useRef<HTMLPreElement | null>(null);
  const typedLenRef = useRef(0);
  const [typedLen, setTypedLen] = useState(0);
  const label = thinkingSegmentLabel(item, index, items, streaming, endAt);
  const preview = thinkingPreview(item.detail);
  const reduceMotion = prefersReducedMotion();

  // Live: type toward the latest preview. Settled + expanded: full text.
  const targetLen = preview.length;
  const displayText = running
    ? reduceMotion
      ? preview
      : typedSlice(preview, typedLen)
    : preview;
  const showPreview = running || (expanded && Boolean(preview));
  const showCaret = running && !reduceMotion;

  useEffect(() => {
    if (!running) {
      typedLenRef.current = targetLen;
      setTypedLen(targetLen);
      return;
    }
    if (reduceMotion) {
      typedLenRef.current = targetLen;
      setTypedLen(targetLen);
      return;
    }
    // New / shorter source (new thinking segment) — soft reset.
    if (typedLenRef.current > targetLen) {
      typedLenRef.current = 0;
      setTypedLen(0);
    }
    if (typedLenRef.current >= targetLen) return;

    const id = window.setInterval(() => {
      const next = nextTypedLength(typedLenRef.current, targetLen);
      if (next === typedLenRef.current) return;
      typedLenRef.current = next;
      setTypedLen(next);
    }, TYPE_TICK_MS);
    return () => window.clearInterval(id);
  }, [running, targetLen, reduceMotion, item.id]);

  useEffect(() => {
    if (!running) return;
    const el = previewRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [running, displayText]);

  return (
    <span
      className={`timeline__row-text timeline__row-text--thinking${
        running ? ' timeline__row-text--thinking-live' : ' timeline__row-text--muted'
      }`}
    >
      <button
        type="button"
        className="timeline__thinking-toggle"
        onClick={() => {
          if (running || !preview) return;
          setExpanded((v) => !v);
        }}
        disabled={running || !preview}
        aria-expanded={!running && preview ? expanded : undefined}
        aria-label={label}
      >
        <span className="timeline__thinking-status" aria-hidden>
          <span className="timeline__thinking-status-dot" />
        </span>
        <span className="timeline__thinking-label">
          {label}
          {running ? (
            <span className="timeline__thinking-pulse-text" aria-hidden>
              …
            </span>
          ) : null}
        </span>
        {!running && preview ? (
          <span className="timeline__thinking-chevron" aria-hidden>
            {expanded ? '▾' : '▸'}
          </span>
        ) : null}
      </button>
      {showPreview ? (
        <div
          className={`timeline__thinking-stream${
            running ? ' timeline__thinking-stream--live' : ''
          }`}
        >
          {preview || running ? (
            <pre ref={previewRef} className="timeline__thinking-preview">
              {displayText || (running ? '\u00a0' : '')}
              {showCaret ? (
                <span className="timeline__thinking-caret" aria-hidden />
              ) : null}
            </pre>
          ) : null}
        </div>
      ) : null}
    </span>
  );
}

export function ActivityTimeline({
  items,
  streaming = false,
  endAt,
}: ActivityTimelineProps) {
  const rows = timelineRowsForPaint(items, streaming);
  if (rows.length === 0) return null;

  return (
    <ol
      className={`timeline${streaming ? ' timeline--streaming' : ''}`}
      aria-label="Agent activity"
    >
      {rows.map((item, index) => {
        const isLast = index === rows.length - 1;
        const running = Boolean(
          item.status === 'running' ||
            (streaming &&
              isLast &&
              item.status !== 'done' &&
              item.status !== 'failed'),
        );
        const state = rowState(item, running);
        const branch = BRANCHES[index % BRANCHES.length];
        const isThinking = item.kind === 'thinking';
        const thinkingActive = isThinking && running;

        return (
          <li
            key={item.id}
            className={[
              'timeline__row',
              `timeline__row--${state}`,
              `timeline__row--kind-${item.kind}`,
              `timeline__row--branch-${branch}`,
              item.kind === 'tool' ? 'timeline__row--tool' : '',
              thinkingActive ? 'timeline__row--thinking-active' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            <span className="timeline__marker" aria-hidden />
            {isThinking ? (
              <ThinkingRow
                item={item}
                index={index}
                items={rows}
                streaming={streaming}
                endAt={endAt}
                running={running}
              />
            ) : (
              <span
                className={`timeline__row-text${
                  state === 'muted' ? ' timeline__row-text--muted' : ''
                }`}
              >
                <span className="timeline__row-title">{item.title}</span>
                {item.paths && item.paths.length > 0 ? (
                  <span className="timeline__paths">
                    {item.paths.map((p) => (
                      <span key={p} className="timeline__path-chip">
                        {p}
                      </span>
                    ))}
                  </span>
                ) : null}
                {item.detail && !(item.paths && item.paths.length > 0) ? (
                  <span className="timeline__row-detail">{item.detail}</span>
                ) : null}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
