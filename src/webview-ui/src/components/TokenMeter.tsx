import { useEffect, useRef, useState } from 'react';
import type { TokenUsageView } from '../../../vscode/webview/messages';
import { IconTokens } from './Icons';

interface TokenMeterProps {
  usage: TokenUsageView;
  compact?: boolean;
  placement?: 'above' | 'below';
}

function formatCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return n.toLocaleString();
}

export function TokenMeter({ usage, compact = false, placement = 'below' }: TokenMeterProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const pct = usage.contextWindow > 0
    ? Math.min(100, Math.round((usage.lastPromptTokens / usage.contextWindow) * 100))
    : 0;

  const tooltip = [
    `Session: ${usage.sessionTotal.toLocaleString()} tokens`,
    `Last prompt: ${usage.lastPromptTokens.toLocaleString()}`,
    `Context: ${usage.lastContextTokens.toLocaleString()} · Output: ${usage.lastResponseTokens.toLocaleString()}`,
    `${usage.turnCount} turns · ${pct}% of context window`,
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

  if (compact) {
    const totalBreakdown = usage.breakdown.reduce((sum, item) => sum + item.tokens, 0);
    return (
      <div className={`token-popover token-popover--${placement}`} ref={popoverRef}>
        <button
          type="button"
          className={`token-chip${open ? ' token-chip--active' : ''}`}
          title={tooltip}
          aria-label="Token usage"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <IconTokens width={13} height={13} />
          <span>{formatCompact(usage.sessionTotal)}</span>
        </button>
        {open && (
          <div className="token-popover__panel" role="dialog" aria-label="Token usage details">
            <div className="token-popover__header">
              <span>Context</span>
              <strong>{pct}% Full</strong>
            </div>
            <div className="token-popover__summary">
              <span>{formatCompact(usage.lastPromptTokens)} / {formatCompact(usage.contextWindow)} Tokens</span>
            </div>
            <div className="token-popover__bar" aria-hidden="true">
              <div className="token-popover__fill" style={{ width: `${pct}%` }} />
            </div>
            {usage.breakdown.length > 0 && (
              <div className="token-popover__segments" aria-hidden="true">
                {usage.breakdown.map((item) => (
                  <span
                    key={item.label}
                    style={{
                      width: `${Math.max(2, (item.tokens / Math.max(totalBreakdown, 1)) * 100)}%`,
                      background: item.color,
                    }}
                  />
                ))}
              </div>
            )}
            {usage.breakdown.length > 0 && (
              <dl className="token-popover__breakdown">
                {usage.breakdown.map((item) => (
                  <div key={item.label}>
                    <dt>
                      <span style={{ background: item.color }} aria-hidden="true" />
                      {item.label}
                    </dt>
                    <dd>{formatCompact(item.tokens)}</dd>
                  </div>
                ))}
              </dl>
            )}
            <dl className="token-popover__stats">
              <div>
                <dt>Session</dt>
                <dd>{usage.sessionTotal.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Last prompt</dt>
                <dd>{usage.lastPromptTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Context</dt>
                <dd>{usage.lastContextTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Output</dt>
                <dd>{usage.lastResponseTokens.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Turns</dt>
                <dd>{usage.turnCount.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Window</dt>
                <dd>{pct}%</dd>
              </div>
            </dl>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="token-meter" title={tooltip}>
      <div className="token-meter__row">
        <span className="token-meter__label">Tokens</span>
        <span className="token-meter__value">{formatCompact(usage.sessionTotal)}</span>
      </div>
      <div className="token-meter__bar" aria-hidden="true">
        <div className="token-meter__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
