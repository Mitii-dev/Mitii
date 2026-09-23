/**
 * Mobile-style status icon for workspace index (top bar).
 * Icon-only; click opens popover with live stream + Reindex.
 */

import { useEffect, useRef, useState } from 'react';

export type DesktopIndexSnapshot = {
  indexed: boolean;
  fileCount: number;
  truncated: boolean;
  lastIndexedAt?: string;
  message: string;
  embeddingError?: string;
};

export type IndexChipTone = 'idle' | 'indexing' | 'ready' | 'warn';

export function resolveIndexTone(
  index: DesktopIndexSnapshot | null,
  indexing: boolean,
): IndexChipTone {
  if (indexing) return 'indexing';
  if (!index) return 'idle';
  if (index.embeddingError) return 'warn';
  if (!index.indexed || index.fileCount <= 0) return 'idle';
  if (index.truncated) return 'warn';
  return 'ready';
}

function toneLabel(tone: IndexChipTone): string {
  if (tone === 'indexing') return 'Indexing';
  if (tone === 'warn') return 'Index warning';
  if (tone === 'ready') return 'Indexed';
  return 'Not indexed';
}

function IndexGlyph({ tone }: { tone: IndexChipTone }) {
  if (tone === 'indexing') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <circle
          cx="8"
          cy="8"
          r="5.5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray="8 18"
          className="index-status__spin"
        />
        <circle cx="8" cy="8" r="2" fill="currentColor" opacity="0.85" />
      </svg>
    );
  }
  if (tone === 'ready') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path
          fill="currentColor"
          d="M2.5 4.2c0-.7.6-1.2 1.3-1.2h8.4c.7 0 1.3.5 1.3 1.2v1.1H2.5V4.2Zm0 2.6h11v1.6c0 .7-.6 1.2-1.3 1.2H3.8c-.7 0-1.3-.5-1.3-1.2V6.8Zm0 4.1h11v.9c0 .7-.6 1.2-1.3 1.2H3.8c-.7 0-1.3-.5-1.3-1.2v-.9Z"
        />
        <path
          fill="none"
          stroke="var(--mitii-panel)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M5.2 8.4 7 10.1l3.8-3.8"
        />
      </svg>
    );
  }
  if (tone === 'warn') {
    return (
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
        <path
          fill="currentColor"
          d="M2.5 4.2c0-.7.6-1.2 1.3-1.2h8.4c.7 0 1.3.5 1.3 1.2v7.6c0 .7-.6 1.2-1.3 1.2H3.8c-.7 0-1.3-.5-1.3-1.2V4.2Z"
          opacity="0.35"
        />
        <path
          fill="currentColor"
          d="M8 3.2 13.2 12H2.8L8 3.2Zm0 2.4-.1 3.2h.2L8 5.6Zm0 4.2c.4 0 .7.3.7.7s-.3.7-.7.7-.7-.3-.7-.7.3-.7.7-.7Z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        d="M3.2 4.4c0-.7.6-1.2 1.3-1.2h7c.7 0 1.3.5 1.3 1.2v7.2c0 .7-.6 1.2-1.3 1.2h-7c-.7 0-1.3-.5-1.3-1.2V4.4Z"
      />
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        d="M3.2 6.6h9.6M3.2 9.4h9.6"
      />
    </svg>
  );
}

interface IndexStatusChipProps {
  index: DesktopIndexSnapshot | null;
  indexing?: boolean;
  progressPercent?: number | null;
  streamLines?: string[];
  workspaceLabel?: string;
  reindexing?: boolean;
  onReindex: () => void;
  onPause?: () => void;
  onOpenSettings?: () => void;
}

export function IndexStatusChip(props: IndexStatusChipProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const streamRef = useRef<HTMLDivElement>(null);
  const indexing = Boolean(props.indexing);
  const tone = resolveIndexTone(props.index, indexing);
  const label = toneLabel(tone);
  const stream = props.streamLines ?? [];

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (!open || !streamRef.current) return;
    streamRef.current.scrollTop = streamRef.current.scrollHeight;
  }, [open, stream, props.progressPercent]);

  useEffect(() => {
    if (indexing) setOpen(true);
  }, [indexing]);

  const meta: string[] = [];
  if (props.index) {
    meta.push(
      props.index.fileCount > 0
        ? `${props.index.fileCount.toLocaleString()} files`
        : 'No files yet',
    );
    if (props.index.truncated) meta.push('Truncated');
    if (props.index.embeddingError) meta.push('Embedding issue');
    if (props.index.lastIndexedAt) {
      meta.push(new Date(props.index.lastIndexedAt).toLocaleString());
    }
  } else {
    meta.push('Status unavailable');
  }

  return (
    <div
      className={`status-icons index-status${open ? ' is-open' : ''}`}
      ref={wrapRef}
    >
      <button
        type="button"
        className={`status-icon status-icon--${tone}`}
        aria-label={`${label}${props.workspaceLabel ? ` · ${props.workspaceLabel}` : ''}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={label}
        onClick={() => setOpen((v) => !v)}
      >
        <IndexGlyph tone={tone} />
        {indexing &&
        props.progressPercent != null &&
        props.progressPercent >= 0 ? (
          <span className="status-icon__ring" aria-hidden>
            <span
              style={{
                ['--index-p' as string]: `${Math.min(100, props.progressPercent)}%`,
              }}
            />
          </span>
        ) : null}
      </button>

      {open ? (
        <div className="index-status__panel" role="dialog" aria-label="Index">
          <div className="index-status__head">
            <div className="index-status__head-main">
              <span className={`index-status__pill index-status__pill--${tone}`}>
                {label}
              </span>
              {props.workspaceLabel ? (
                <span className="index-status__repo">{props.workspaceLabel}</span>
              ) : null}
            </div>
            <div className="index-status__head-actions">
              {indexing && props.onPause ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => props.onPause?.()}
                >
                  Pause
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-primary index-status__reindex"
                disabled={indexing || props.reindexing}
                onClick={() => props.onReindex()}
              >
                {indexing || props.reindexing ? 'Indexing…' : 'Reindex'}
              </button>
            </div>
          </div>

          {indexing &&
          props.progressPercent != null &&
          props.progressPercent >= 0 ? (
            <div className="index-status__progress" aria-hidden>
              <div className="index-status__progress-track">
                <span
                  style={{
                    width: `${Math.min(100, props.progressPercent)}%`,
                  }}
                />
              </div>
              <span className="index-status__progress-pct">
                {Math.round(props.progressPercent)}%
              </span>
            </div>
          ) : null}

          <div className="index-status__meta">{meta.join(' · ')}</div>

          <div className="index-status__stream" ref={streamRef}>
            {stream.length === 0 ? (
              <div className="index-status__stream-empty">
                {indexing
                  ? 'Waiting for index updates…'
                  : 'Click Reindex to build or refresh this workspace index.'}
              </div>
            ) : (
              stream.map((line, i) => (
                <div key={`${i}-${line.slice(0, 24)}`} className="index-status__line">
                  {line}
                </div>
              ))
            )}
          </div>

          {props.onOpenSettings ? (
            <button
              type="button"
              className="btn btn-ghost index-status__settings"
              onClick={() => {
                setOpen(false);
                props.onOpenSettings?.();
              }}
            >
              Index settings…
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
