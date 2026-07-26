import { useEffect, useRef, useState } from 'react';

import type { TokenUsageSnapshot } from './protocol';

interface TokenMeterProps {
  usage: TokenUsageSnapshot;
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function TokenMeter({ usage }: TokenMeterProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputTotal = usage.inputTokensTotal;
  const outputTotal = usage.outputTokensTotal;
  const sessionTotal = usage.sessionTotal;
  const pct =
    usage.contextWindow > 0
      ? Math.round((usage.lastPromptTokens / usage.contextWindow) * 100)
      : 0;

  const tooltip = [
    `Session total: ${sessionTotal.toLocaleString()} tokens`,
    `Input: ${inputTotal.toLocaleString()} · Output: ${outputTotal.toLocaleString()}`,
    `Model calls: ${usage.modelCalls} · Tools: ${usage.toolCalls}`,
    `Turns: ${usage.turnCount}`,
  ].join('\n');

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
    <div className="token-popover" ref={popoverRef}>
      <button
        type="button"
        className={`token-chip${open ? ' token-chip--active' : ''}`}
        title={tooltip}
        aria-label="Session token usage"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="token-chip__glyph" aria-hidden="true">
          ⌗
        </span>
        <span>{formatCompact(sessionTotal)}</span>
        <span className="token-chip__sep">·</span>
        <span className="token-chip__io">
          <span aria-hidden="true">↑</span>
          <span>{formatCompact(inputTotal)}</span>
          <span aria-hidden="true">↓</span>
          <span>{formatCompact(outputTotal)}</span>
        </span>
        <span className="token-chip__sep">·</span>
        <span>{usage.modelCalls} calls</span>
      </button>
      {open ? (
        <div className="token-popover__panel" role="dialog" aria-label="Token usage details">
          <div className="token-popover__header">
            <span>Session tokens</span>
            <strong>{usage.estimated ? 'Estimated' : 'Provider reported'}</strong>
          </div>
          <dl className="token-popover__stats">
            <div>
              <dt>Total</dt>
              <dd>{sessionTotal.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Input</dt>
              <dd>{inputTotal.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Output</dt>
              <dd>{outputTotal.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Turn</dt>
              <dd>{usage.currentTurnTotal.toLocaleString()}</dd>
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
              <dt>Loops</dt>
              <dd>{usage.loopIterations.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Turns</dt>
              <dd>{usage.turnCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Last prompt</dt>
              <dd>{usage.lastPromptTokens.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Window used</dt>
              <dd>{pct}%</dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
