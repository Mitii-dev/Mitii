import { useEffect, useRef, useState, type CSSProperties } from 'react';

import type { TokenUsageSnapshot } from './protocol';
import { IconTokens } from './components/Icons';

interface TokenMeterProps {
  usage: TokenUsageSnapshot;
  placement?: 'above' | 'below';
}

const CONTEXT_SLICE_COLORS: Record<string, string> = {
  prompt: '#7c8794',
  conversation: '#64748b',
  pinned: '#8b949e',
  memory: '#6b7280',
  editor: '#707b87',
  diagnostics: '#9a6b6b',
  gitDiff: '#6f8794',
  repoMap: '#71806f',
  mcp: '#777189',
  depth: '#9aa6b2',
  runtime: '#5f6b77',
};

function contextSliceColor(id: string): string {
  return CONTEXT_SLICE_COLORS[id] ?? '#8da2fb';
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

function formatPct(ratio: number): string {
  return `${Math.round(ratio * 1000) / 10}%`;
}

function formatDuration(ms?: number): string {
  if (!ms || ms <= 0) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds < 10 ? 1 : 0)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}

export function TokenMeter({ usage, placement = 'above' }: TokenMeterProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputTotal = usage.inputTokensTotal;
  const outputTotal = usage.outputTokensTotal;
  const sessionTotal = usage.sessionTotal || inputTotal + outputTotal;
  const windowLabel =
    usage.contextWindow > 0 ? formatCompact(usage.contextWindow) : null;
  const turns = usage.turns ?? [];
  const breakdown = usage.contextBreakdown;
  const latestCall = turns[turns.length - 1];
  const latestInput = latestCall?.inputTokens ?? usage.lastPromptTokens;
  const latestOutput = latestCall?.outputTokens ?? usage.lastResponseTokens;
  const latestTotal = latestInput + latestOutput;
  const liveCallLabel = latestCall
    ? `Call ${latestCall.turnIndex + 1}`
    : 'Latest call';
  const runTotal = usage.currentTurnTotal;
  const attributedInputTokens = breakdown?.totalTokens ?? 0;
  const runtimeTokens =
    breakdown && latestInput > attributedInputTokens
      ? latestInput - attributedInputTokens
      : 0;
  const inputSourceTotal = breakdown
    ? Math.max(latestInput, attributedInputTokens)
    : 0;
  const inputSourceRows = breakdown
    ? [
        ...breakdown.slices,
        ...(runtimeTokens > 0
          ? [
              {
                id: 'runtime',
                label: 'Runtime / system',
                tokens: runtimeTokens,
                active: true,
              },
            ]
          : []),
      ]
    : [];
  const sourceRows = [...inputSourceRows].sort((a, b) => {
    if (b.tokens !== a.tokens) return b.tokens - a.tokens;
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.label.localeCompare(b.label);
  });
  const activeSourceRows = sourceRows.filter((s) => s.active && s.tokens > 0);
  const fillRatio = breakdown?.fillRatio ?? 0;

  const tooltip = [
    usage.live ? 'Live · updating cumulative chat totals' : null,
    `This chat: ${sessionTotal.toLocaleString()} tokens (input + output)`,
    `Input: ${inputTotal.toLocaleString()} · Output: ${outputTotal.toLocaleString()}`,
    `Latest call: ${latestInput.toLocaleString()} in · ${latestOutput.toLocaleString()} out`,
    usage.contextWindow > 0
      ? `Model window: ${usage.contextWindow.toLocaleString()} tokens`
      : null,
    breakdown
      ? `Context fill: ${formatCompact(breakdown.totalTokens)} / ${formatCompact(breakdown.contextWindow)} (${formatPct(fillRatio)})`
      : null,
    `Model calls: ${usage.modelCalls} · Tools: ${usage.toolCalls}`,
    `Turns: ${usage.turnCount}`,
  ]
    .filter(Boolean)
    .join('\n');

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!popoverRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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
    <div
      className={`token-popover token-popover--${placement}`}
      ref={popoverRef}
    >
      <button
        type="button"
        className={`token-chip${open ? ' token-chip--active' : ''}${usage.live ? ' token-chip--live' : ''}`}
        title={tooltip}
        aria-label="Chat token usage"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="token-chip__glyph" aria-hidden="true">
          <IconTokens width={14} height={14} />
        </span>
        <span>{formatCompact(sessionTotal)}</span>
        <span className="token-chip__sep">·</span>
        <span
          className="token-chip__io"
          aria-label={
            `Input ${inputTotal.toLocaleString()} tokens, output ${outputTotal.toLocaleString()} tokens`
          }
        >
          <span aria-hidden="true">↑</span>
          <span>{formatCompact(inputTotal)}</span>
          <span aria-hidden="true">↓</span>
          <span>{formatCompact(outputTotal)}</span>
        </span>
        {usage.live ? (
          <>
            <span className="token-chip__sep">·</span>
            <span className="token-chip__live">
              {formatCompact(runTotal)}
            </span>
          </>
        ) : null}
        {/* {windowLabel ? (
          <>
            <span className="token-chip__sep">·</span>
            <span>
              {breakdown
                ? `${formatPct(fillRatio)} of ${windowLabel}`
                : `${windowLabel} window`}
            </span>
          </>
        ) : null} */}
      </button>
      {open ? (
        <div
          className="token-popover__panel token-popover__panel--wide"
          role="dialog"
          aria-label="Token usage details"
        >
          <div className="token-popover__header">
            <span>
              {usage.live ? 'Live chat token monitor' : 'Chat token summary'}
            </span>
            <strong>
              {usage.live ? 'Live' : usage.estimated ? 'Estimated' : 'Reported'}
            </strong>
          </div>

          {!usage.live ? (
            <dl className="token-popover__stats token-popover__stats--primary token-popover__stats--first">
              <div>
                <dt>Total tokens</dt>
                <dd>{sessionTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total sent</dt>
                <dd>{inputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total received</dt>
                <dd>{outputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Model calls</dt>
                <dd>{usage.modelCalls.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Tool calls</dt>
                <dd>{usage.toolCalls.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Duration</dt>
                <dd>{formatDuration(usage.durationMs)}</dd>
              </div>
            </dl>
          ) : (
            <dl className="token-popover__stats token-popover__stats--primary token-popover__stats--compact token-popover__stats--first">
              <div>
                <dt>Chat total</dt>
                <dd>{sessionTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total sent</dt>
                <dd>{inputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Total received</dt>
                <dd>{outputTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Current run</dt>
                <dd>{runTotal.toLocaleString()}</dd>
              </div>
            </dl>
          )}

          <section className="token-call-card" aria-label="Latest model call">
            <div className="token-call-card__top">
              <span>{liveCallLabel}</span>
              <strong>{formatCompact(latestTotal || usage.currentTurnTotal)}</strong>
            </div>
            <div className="token-call-card__io">
              <div>
                <span>Sent</span>
                <strong>↑{latestInput.toLocaleString()}</strong>
              </div>
              <div>
                <span>Received</span>
                <strong>↓{latestOutput.toLocaleString()}</strong>
              </div>
            </div>
            <div className="token-call-card__meta">
              <span>
                {usage.live ? 'Current run' : 'Last completed run'} ·{' '}
                {formatCompact(runTotal)} tokens
              </span>
              {latestCall?.finishReason ? <span>{latestCall.finishReason}</span> : null}
              {latestCall?.truncated ? <span>truncated</span> : null}
              {latestCall?.estimated || usage.estimated ? <span>estimated</span> : null}
            </div>
          </section>

          <dl className="token-popover__stats token-popover__stats--tiny">
            <div>
              <dt>Context window</dt>
              <dd>{windowLabel ?? '—'}</dd>
            </div>
            <div>
              <dt>Window used</dt>
              <dd>{breakdown ? formatPct(fillRatio) : '—'}</dd>
            </div>
            <div>
              <dt>Context tokens</dt>
              <dd>{breakdown ? breakdown.totalTokens.toLocaleString() : '—'}</dd>
            </div>
            <div>
              <dt>Turns</dt>
              <dd>{usage.turnCount.toLocaleString()}</dd>
            </div>
          </dl>

          {breakdown ? (
            <section className="token-source-panel" aria-label="Input attribution">
              <div className="token-popover__section-title token-popover__section-title--flush">
                <span>
                  {usage.live ? 'Latest input by source' : 'Final context by source'}
                </span>
                <span className="token-popover__section-meta">
                  {formatCompact(breakdown.totalTokens)} /{' '}
                  {formatCompact(breakdown.contextWindow)} ·{' '}
                  {formatPct(fillRatio)}
                  {breakdown.estimated ? ' · est.' : ''}
                </span>
              </div>
              <div
                className="token-fill token-fill--segmented"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fillRatio * 100)}
                aria-label="Context window fill"
              >
                {activeSourceRows.map((slice) => {
                  const share =
                    inputSourceTotal > 0
                      ? slice.tokens / inputSourceTotal
                      : 0;
                  return (
                    <span
                      key={slice.id}
                      className="token-fill__segment"
                      title={`${slice.label}: ${slice.tokens.toLocaleString()} tokens`}
                      style={
                        {
                          '--token-slice-color': contextSliceColor(slice.id),
                          width: `${Math.max(2, share * 100)}%`,
                        } as CSSProperties
                      }
                    />
                  );
                })}
              </div>
              <ul className="token-context-slices token-context-slices--monitor">
                {sourceRows.map((slice) => {
                  const share =
                    breakdown.contextWindow > 0
                      ? slice.tokens / breakdown.contextWindow
                      : 0;
                  const inputShare =
                    inputSourceTotal > 0
                      ? slice.tokens / inputSourceTotal
                      : 0;
                  return (
                    <li
                      key={slice.id}
                      className={
                        slice.active && slice.tokens > 0
                          ? 'token-context-slice'
                          : 'token-context-slice token-context-slice--idle'
                      }
                      style={
                        {
                          '--token-slice-color': contextSliceColor(slice.id),
                        } as CSSProperties
                      }
                    >
                      <div className="token-context-slice__label">
                        <span>{slice.label}</span>
                        <span>
                          {slice.tokens > 0
                            ? `${slice.tokens.toLocaleString()} · ${formatPct(inputShare)}`
                            : '—'}
                        </span>
                      </div>
                      <div className="token-context-slice__track">
                        <div
                          className="token-context-slice__bar"
                          style={{
                            width: `${Math.min(100, share * 100)}%`,
                          }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
              {activeSourceRows.length === 0 ? (
                <div className="token-popover__summary token-popover__summary--start">
                  <span>No context slices attached yet.</span>
                </div>
              ) : null}
            </section>
          ) : (
            <div className="token-popover__summary token-popover__summary--start">
              <span>Context attribution will appear once the run builds a prompt.</span>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
