import { useEffect, useRef, useState } from 'react';

import type { TokenUsageSnapshot } from './protocol';
import { IconTokens } from './components/Icons';

interface TokenMeterProps {
  usage: TokenUsageSnapshot;
  placement?: 'above' | 'below';
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
  const activeSlices = (breakdown?.slices ?? []).filter(
    (s) => s.active && s.tokens > 0,
  );
  const fillRatio = breakdown?.fillRatio ?? 0;

  const tooltip = [
    usage.live ? 'Live · updating each model call' : null,
    `This chat: ${sessionTotal.toLocaleString()} tokens (input + output)`,
    `Input: ${inputTotal.toLocaleString()} · Output: ${outputTotal.toLocaleString()}`,
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
          aria-label={`Input ${inputTotal.toLocaleString()} tokens, output ${outputTotal.toLocaleString()} tokens`}
        >
          <span aria-hidden="true">↑</span>
          <span>{formatCompact(inputTotal)}</span>
          <span aria-hidden="true">↓</span>
          <span>{formatCompact(outputTotal)}</span>
        </span>
        {usage.live ? (
          <>
            <span className="token-chip__sep">·</span>
            <span className="token-chip__live">live</span>
          </>
        ) : null}
        {windowLabel ? (
          <>
            <span className="token-chip__sep">·</span>
            <span>
              {breakdown
                ? `${formatPct(fillRatio)} of ${windowLabel}`
                : `${windowLabel} window`}
            </span>
          </>
        ) : null}
      </button>
      {open ? (
        <div
          className="token-popover__panel token-popover__panel--wide"
          role="dialog"
          aria-label="Token usage details"
        >
          <div className="token-popover__header">
            <span>This chat · AI tokens</span>
            <strong>
              {usage.live
                ? 'Live'
                : usage.estimated
                  ? 'Estimated'
                  : 'Provider reported'}
            </strong>
          </div>
          <div className="token-popover__summary">
            <span>
              {formatCompact(sessionTotal)} total · {usage.modelCalls} calls
            </span>
          </div>
          <dl className="token-popover__stats token-popover__stats--primary">
            <div>
              <dt>Total sent</dt>
              <dd>{inputTotal.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Total received</dt>
              <dd>{outputTotal.toLocaleString()}</dd>
            </div>
            <div>
              <dt>This run</dt>
              <dd>{usage.currentTurnTotal.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Run I/O</dt>
              <dd>
                {usage.currentTurnInputTokens.toLocaleString()} /{' '}
                {usage.currentTurnOutputTokens.toLocaleString()}
              </dd>
            </div>
          </dl>

          {breakdown ? (
            <>
              <div className="token-popover__section-title">
                <span>Context window</span>
                <span className="token-popover__section-meta">
                  {formatCompact(breakdown.totalTokens)} /{' '}
                  {formatCompact(breakdown.contextWindow)} ·{' '}
                  {formatPct(fillRatio)}
                  {breakdown.estimated ? ' · est.' : ''}
                </span>
              </div>
              <div
                className="token-fill"
                role="meter"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(fillRatio * 100)}
                aria-label="Context window fill"
              >
                <div
                  className="token-fill__bar"
                  style={{ width: `${Math.min(100, fillRatio * 100)}%` }}
                />
              </div>
              <ul className="token-context-slices">
                {(breakdown.slices ?? []).map((slice) => {
                  const share =
                    breakdown.contextWindow > 0
                      ? slice.tokens / breakdown.contextWindow
                      : 0;
                  return (
                    <li
                      key={slice.id}
                      className={
                        slice.active && slice.tokens > 0
                          ? 'token-context-slice'
                          : 'token-context-slice token-context-slice--idle'
                      }
                    >
                      <div className="token-context-slice__label">
                        <span>{slice.label}</span>
                        <span>
                          {slice.tokens > 0
                            ? `${formatCompact(slice.tokens)} · ${formatPct(share)}`
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
              {activeSlices.length === 0 ? (
                <div className="token-popover__summary token-popover__summary--start">
                  <span>No context slices attached yet.</span>
                </div>
              ) : null}
            </>
          ) : null}

          <div className="token-popover__section-title">
            <span>Per model call</span>
          </div>
          {turns.length === 0 ? (
            <div className="token-popover__summary token-popover__summary--start">
              <span>No model calls yet in this chat.</span>
            </div>
          ) : (
            <ul className="token-popover__turns">
              {[...turns].reverse().map((turn, index) => (
                <li
                  key={`${turn.at}-${turn.turnIndex}-${index}`}
                  className={
                    turn.truncated
                      ? 'token-popover__turn token-popover__turn--truncated'
                      : 'token-popover__turn'
                  }
                >
                  <span className="token-popover__turn-label">
                    Call {turn.turnIndex + 1}
                    {turn.truncated ? ' · truncated' : ''}
                    {turn.estimated ? ' · est.' : ''}
                  </span>
                  <span className="token-popover__turn-io">
                    <span>↑{turn.inputTokens.toLocaleString()}</span>
                    <span>↓{turn.outputTokens.toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
