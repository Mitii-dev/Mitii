import type { TokenUsageView } from '../../../vscode/webview/messages';

interface TokenMeterProps {
  usage: TokenUsageView;
}

export function TokenMeter({ usage }: TokenMeterProps) {
  const pct = usage.contextWindow > 0
    ? Math.min(100, Math.round((usage.lastContextTokens / usage.contextWindow) * 100))
    : 0;

  return (
    <div className="token-meter" title="Session token usage estimate">
      <div className="token-meter__row">
        <span className="token-meter__label">Tokens</span>
        <span className="token-meter__value">
          {usage.sessionTotal.toLocaleString()} session
        </span>
      </div>
      <div className="token-meter__row token-meter__row--detail">
        <span>Last turn: {usage.lastContextTokens.toLocaleString()} ctx + {usage.lastResponseTokens.toLocaleString()} out</span>
        <span>{usage.turnCount} turns</span>
      </div>
      <div className="token-meter__bar" aria-hidden="true">
        <div className="token-meter__fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="token-meter__hint">
        Context budget {usage.lastContextTokens.toLocaleString()} / {usage.contextWindow.toLocaleString()} ({pct}%)
      </span>
    </div>
  );
}
