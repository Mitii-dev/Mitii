import { formatCompact, formatDuration, formatPct } from './format.js';
import type { TokenMeterBreakdown, TokenMeterTurn, TokenMeterUsage } from './types.js';

export type LiveStatsLayout = 'compact' | 'full';

export interface UsageStatsProps {
  usage: TokenMeterUsage;
  sessionTotal: number;
  latestCall: TokenMeterTurn | undefined;
  breakdown: TokenMeterBreakdown | undefined;
  windowTokens: number;
  /** While a run is live: 4 compact tiles ('compact') or the full grid ('full'). */
  liveStatsLayout: LiveStatsLayout;
}

/** Session totals, latest-call card, and context-window tiles. */
export function UsageStats({
  usage,
  sessionTotal,
  latestCall,
  breakdown,
  windowTokens,
  liveStatsLayout,
}: UsageStatsProps) {
  const inputTotal = usage.inputTokensTotal;
  const outputTotal = usage.outputTokensTotal;
  const latestInput = latestCall?.inputTokens ?? usage.lastPromptTokens;
  const latestOutput = latestCall?.outputTokens ?? usage.lastResponseTokens;
  const latestTotal = latestInput + latestOutput;
  const liveCallLabel = latestCall
    ? `Call ${latestCall.turnIndex + 1}`
    : 'Latest call';
  const runTotal = usage.currentTurnTotal;
  const fillRatio = breakdown?.fillRatio ?? 0;
  const compact = Boolean(usage.live) && liveStatsLayout === 'compact';

  return (
    <>
      {!compact ? (
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
            <dd>{formatCompact(runTotal)}</dd>
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
          <dd>{windowTokens > 0 ? formatCompact(windowTokens) : '—'}</dd>
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
    </>
  );
}
